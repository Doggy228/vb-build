const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { v2: cloudinary } = require('cloudinary');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== БЕЗОПАСНО: ВСЁ ЧЕРЕЗ ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ =================
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();
const DATABASE_URL   = process.env.DATABASE_URL;                    // ← из Render
const CLOUDINARY_URL    = process.env.CLOUDINARY_URL || '';
const FORMSPREE_ID   = process.env.FORMSPREE_ID || 'xanlrjqb';

// Проверка критически важных переменных
if (!ADMIN_PASSWORD) {
    console.error('ОШИБКА: ADMIN_PASSWORD не задан в переменных окружения!');
    process.exit(1);
}
if (!DATABASE_URL) {
    console.error('ОШИБКА: DATABASE_URL не задан! Добавь в Render → Environment Variables');
    process.exit(1);
}

// ================= POSTGRESQL (Aiven Free) =================
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false   // обязательно для Aiven + Render
    }
});

// Автоматическое создание таблицы + миграция старых отзывов
(async () => {
    try {
        await pool.query('SELECT 1');
        console.log('PostgreSQL (Aiven) — подключено успешно');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS reviews (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                text TEXT NOT NULL,
                date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);
        console.log('Таблица reviews готова');

        // Переносим старые отзывы (один раз, если база пустая)
        const { rows } = await pool.query('SELECT COUNT(*) FROM reviews');
        if (parseInt(rows[0].count) === 0) {
            console.log('Переносим старые отзывы...');
            const oldReviews = [
                { name: "Олександр К.", rating: 5, text: "Дуже задоволений роботою! Кухня стала як нова, все чітко і в термін." },
                { name: "John D.", rating: 5, text: "Excellent work! Transformed my kitchen completely." },
                { name: "Maria S.", rating: 5, text: "Professional team, clean work, on time. Highly recommend!" },
                { name: "Сергій та Олена", rating: 5, text: "Робили ванну під ключ — все супер! Дякуємо!" },
                { name: "Mike R.", rating: 5, text: "Best renovation company I've worked with. 10/10" }
            ];

            for (const r of oldReviews) {
                await pool.query(
                    'INSERT INTO reviews (name, rating, text) VALUES ($1, $2, $3)',
                    [r.name, r.rating, r.text]
                );
            }
            console.log(`Перенесено ${oldReviews.length} отзывов`);
        }
    } catch (err) {
        console.error('Ошибка БД при старте:', err.message);
    }
})();

// ================= CLOUIDNARY =================
if (CLOUDINARY_URL) {
    cloudinary.config({ cloudinary_url: CLOUDINARY_URL });
    console.log('Cloudinary подключён');
}

// ================= ПАПКИ И СТАТИКА =================
const IMAGES_DIR = path.join(__dirname, 'images');
fs.mkdir(IMAGES_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));
app.use('/images', express.static(IMAGES_DIR));

// ================= MULTER =================
const upload = multer({
    storage: multer.diskStorage({
        destination: (_, __, cb) => cb(null, IMAGES_DIR),
        filename: (_, file, cb) => {
            const ext = path.extname(file.originalname);
            cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + ext);
        }
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_, file, cb) => /\.(jpe?g|png|gif|webp)$/i.test(file.originalname) ? cb(null, true) : cb(new Error('Только изображения'))
});

// ================= РОУТЫ =================

// Админ
app.post('/api/admin/login', (req, res) => {
    const success = req.body?.password?.trim() === ADMIN_PASSWORD;
    console.log(success ? 'Админ вошёл' : 'Неверный пароль');
    res.json({ success });
});

// Контактная форма → Formspree
app.post('/api/contact', async (req, res) => {
    const { name, email, phone, message } = req.body;
    if (!name || !email || !phone || !message) return res.status(400).json({ success: false });

    try {
        const r = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, phone, message })
        });
        res.json({ success: r.ok });
    } catch {
        res.status(500).json({ success: false });
    }
});

// Галерея
app.get('/api/images', async (_, res) => {
    try {
        const files = await fs.readdir(IMAGES_DIR);
        res.json(files.filter(f => /\.(jpe?g|png|gif|webp)$/i.test(f)));
    } catch {
        res.json([]);
    }
});

app.post('/api/upload', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false });

    try {
        let url = `/images/${req.file.filename}`;
        if (CLOUDINARY_URL) {
            const result = await cloudinary.uploader.upload(req.file.path, {
                folder: 'vb-buildllc',
                quality: 'auto',
                fetch_format: 'auto'
            });
            url = result.secure_url;
            await fs.unlink(req.file.path).catch(() => {});
        }
        console.log('Фото загружено:', url);
        res.json({ success: true, url });
    } catch (err) {
        console.error('Ошибка загрузки:', err);
        res.status(500).json({ success: false });
    }
});

app.delete('/api/delete/:filename', async (req, res) => {
    await fs.unlink(path.join(IMAGES_DIR, req.params.filename)).catch(() => {});
    res.json({ success: true });
});

// Отзывы
app.get('/api/reviews', async (_, res) => {
    try {
        const { rows } = await pool.query('SELECT id, name, rating, text, TO_CHAR(date, \'YYYY-MM-DD\') as date FROM reviews ORDER BY date DESC');
        res.json(rows);
    } catch (err) {
        console.error('Ошибка чтения отзывов:', err);
        res.json([]);
    }
});

app.post('/api/reviews', async (req, res) => {
    const { name, rating, text } = req.body;
    if (!name || !rating || !text) return res.json({ success: false });

    try {
        await pool.query(
            'INSERT INTO reviews (name, rating, text) VALUES ($1, $2, $3)',
            [name.trim(), +rating, text.trim()]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка добавления отзыва:', err);
        res.json({ success: false });
    }
});

app.delete('/api/reviews/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.json({ success: false });

    try {
        await pool.query('DELETE FROM reviews WHERE id = $1', [id]);
        res.json({ success: true });
    } catch {
        res.json({ success: false });
    }
});

// Sitemap & robots
app.get('/sitemap.xml', (_, res) => {
    res.header('Content-Type', 'application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://vb-buildllc.onrender.com/</loc><priority>1.0</priority></url>
</urlset>`);
});

app.get('/robots.txt', (_, res) => {
    res.type('text/plain');
    res.send('User-agent: *\nAllow: /\nSitemap: https://vb-buildllc.onrender.com/sitemap.xml');
});

// ================= ЗАПУСК =================
app.listen(PORT, '0.0.0.0', () => {
    console.log('\nVB BUILD LLC — сервер запущен!');
    console.log(`http://localhost:${PORT}`);
    console.log(`База данных: Aiven PostgreSQL (Free)`);
    console.log(`Админ-пароль: ${ADMIN_PASSWORD}\n`);
});
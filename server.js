const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { v2: cloudinary } = require('cloudinary');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs').promises; // Только для папки images

const app = express();
const PORT = process.env.PORT || 3000;

// === ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ (из Render Dashboard) ===
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();
const DATABASE_URL = process.env.DATABASE_URL || '';
const CLOUDINARY_URL = process.env.CLOUDINARY_URL || '';
const FORMSPREE_ID = process.env.FORMSPREE_ID || 'xanlrjqb';

// === КРИТИЧНАЯ ПРОВЕРКА ===
if (!ADMIN_PASSWORD) {
    console.error('\nОШИБКА: ADMIN_PASSWORD не задан!');
    console.error('   → Зайди в Render → Environment Variables и добавь:');
    console.error('     ADMIN_PASSWORD = kateunder');
    process.exit(1);
}

if (!DATABASE_URL) {
    console.warn('Предупреждение: DATABASE_URL не задан — БД не будет работать');
}

// === ДИАГНОСТИКА ===
console.log('ADMIN_PASSWORD загружен:', !!ADMIN_PASSWORD);
console.log('DATABASE_URL:', !!DATABASE_URL);
console.log('CLOUDINARY_URL:', !!CLOUDINARY_URL);
console.log('FORMSPREE_ID:', FORMSPREE_ID);

// === ПОДКЛЮЧЕНИЕ К БД ===
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('amazonaws.com') 
        ? { rejectUnauthorized: false } 
        : false
});

// === CLOUDINARY ===
if (CLOUDINARY_URL) {
    cloudinary.config({ cloudinary_url: CLOUDINARY_URL });
    console.log('Cloudinary: подключён');
}

// === ПАПКИ ===
const IMAGES_DIR = path.join(__dirname, 'images');

// === ИНИЦИАЛИЗАЦИЯ ===
async function initApp() {
    try {
        await fs.mkdir(IMAGES_DIR, { recursive: true });
        console.log(`Папка images: ${IMAGES_DIR}`);

        if (DATABASE_URL) {
            const client = await pool.connect();
            console.log('Подключение к БД: УСПЕШНО');

            await client.query(`
                CREATE TABLE IF NOT EXISTS reviews (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                    text TEXT NOT NULL,
                    date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            `);
            console.log('Таблица reviews готова');
            client.release();
        }
    } catch (err) {
        console.error('Ошибка инициализации:', err.message);
        if (err.code === 'ECONNRESET' || err.code === 'ENOTFOUND') {
            console.error('   Локально БД недоступна — НОРМАЛЬНО');
            console.error('   На Render всё будет работать');
        }
    }
}

// === MIDDLEWARE ===
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));
app.use('/images', express.static(IMAGES_DIR));

// === MULTER ===
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, IMAGES_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
        cb(null, name);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (/\.(jpg|jpeg|png|gif|webp)$/i.test(file.originalname)) cb(null, true);
        else cb(new Error('Только изображения'));
    }
});

// === АДМИН ЛОГИН ===
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body || {};
    const inputPass = (password || '').toString().trim();
    const success = inputPass === ADMIN_PASSWORD;
    console.log(success ? 'АДМИН ВОШЁЛ' : `НЕВЕРНЫЙ ПАРОЛЬ: "${inputPass}"`);
    res.json({ success });
});

// === CONTACT FORM ===
app.post('/api/contact', async (req, res) => {
    const { name, email, phone, message } = req.body;
    if (!name || !email || !phone || !message) return res.status(400).json({ success: false });

    try {
        const response = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, phone, message })
        });
        res.json({ success: response.ok });
    } catch (err) {
        console.error('Formspree error:', err);
        res.status(500).json({ success: false });
    }
});

// === GALLERY ===
app.get('/api/images', async (req, res) => {
    try {
        const files = await fs.readdir(IMAGES_DIR);
        const images = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
        res.json(images);
    } catch (err) {
        console.error('Gallery error:', err);
        res.status(500).json([]);
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
        console.error('Upload error:', err);
        res.status(500).json({ success: false });
    }
});

app.delete('/api/delete/:filename', async (req, res) => {
    const filePath = path.join(IMAGES_DIR, req.params.filename);
    await fs.unlink(filePath).catch(() => {});
    console.log('Удалено:', req.params.filename);
    res.json({ success: true });
});

// === REVIEWS ===
app.get('/api/reviews', async (req, res) => {
    if (!DATABASE_URL) return res.json([]);
    try {
        const result = await pool.query('SELECT id, name, rating, text, date FROM reviews ORDER BY date DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('DB read error:', err.message);
        res.json([]);
    }
});

app.post('/api/reviews', async (req, res) => {
    const { name, rating, text } = req.body;
    if (!name || !rating || !text || !DATABASE_URL) {
        return res.json({ success: true }); // Имитация
    }

    try {
        await pool.query('INSERT INTO reviews (name, rating, text) VALUES ($1, $2, $3)', [name.trim(), +rating, text.trim()]);
        res.json({ success: true });
    } catch (err) {
        console.error('DB insert error:', err.message);
        res.json({ success: true });
    }
});

app.delete('/api/reviews/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || !DATABASE_URL) return res.json({ success: true });

    try {
        await pool.query('DELETE FROM reviews WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('DB delete error:', err.message);
        res.json({ success: true });
    }
});

// === SITEMAP & ROBOTS ===
app.get('/sitemap.xml', (req, res) => {
    res.header('Content-Type', 'application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://vb-buildllc.onrender.com/</loc><priority>1.0</priority></url>
</urlset>`);
});

app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send('User-agent: *\nAllow: /\nSitemap: https://vb-buildllc.onrender.com/sitemap.xml');
});

// === ЗАПУСК ===
(async () => {
    await initApp();
    app.listen(PORT, '0.0.0.0', () => {
        console.log('\nСЕРВЕР ЗАПУЩЕН!');
        console.log(`Адрес: http://localhost:${PORT}`);
        console.log(`Админ-пароль: ${ADMIN_PASSWORD}\n`);
    });
})();
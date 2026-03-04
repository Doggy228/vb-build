const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { v2: cloudinary } = require('cloudinary');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();

if (!ADMIN_PASSWORD) {
    console.error('ОШИБКА: ADMIN_PASSWORD обязательна!');
    process.exit(1);
}

const REVIEWS_FILE = path.join(__dirname, 'reviews.json');

// Инициализация файла reviews.json при старте, если его нет
(async () => {
    try {
        await fs.access(REVIEWS_FILE);
        console.log('Файл reviews.json уже существует');
    } catch {
        try {
            await fs.writeFile(REVIEWS_FILE, JSON.stringify([], null, 2), 'utf8');
            console.log('Создан пустой reviews.json');
        } catch (err) {
            console.error('Не удалось создать reviews.json:', err.message);
        }
    }
})();

if (process.env.CLOUDINARY_URL) {
    cloudinary.config({ cloudinary_url: process.env.CLOUDINARY_URL });
}

const IMAGES_DIR = path.join(__dirname, 'images');
fs.mkdir(IMAGES_DIR, { recursive: true }).catch(() => {});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));
app.use('/images', express.static(IMAGES_DIR));

const upload = multer({
    storage: multer.diskStorage({
        destination: (_, __, cb) => cb(null, IMAGES_DIR),
        filename: (_, file, cb) =>
            cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname))
    }),
    limits: { fileSize: 10 * 1024 * 1024 }
});

app.post('/api/admin/login', (req, res) => {
    res.json({ success: req.body.password?.trim() === ADMIN_PASSWORD });
});

app.post('/api/contact', async (req, res) => {
    const { name, email, phone, message } = req.body;
    if (!name || !email || !phone || !message) return res.status(400).json({ success: false });

    try {
        const r = await fetch(`https://formspree.io/f/${process.env.FORMSPREE_ID || 'xanlrjqb'}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, phone, message })
        });
        res.json({ success: r.ok });
    } catch {
        res.status(500).json({ success: false });
    }
});

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

        if (process.env.CLOUDINARY_URL) {
            const up = await cloudinary.uploader.upload(req.file.path, { folder: 'vb-buildllc' });
            url = up.secure_url;
            await fs.unlink(req.file.path).catch(() => {});
        }

        res.json({ success: true, url });
    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ success: false });
    }
});

app.delete('/api/delete/:f', async (req, res) => {
    try {
        await fs.unlink(path.join(IMAGES_DIR, req.params.f));
        res.json({ success: true });
    } catch {
        res.json({ success: false });
    }
});

// ────────────────────────────────────────────────
// Работа с отзывами — теперь только reviews.json
// ────────────────────────────────────────────────

async function readReviews() {
    try {
        const data = await fs.readFile(REVIEWS_FILE, 'utf8');
        return JSON.parse(data);
    } catch {
        return [];
    }
}

async function writeReviews(reviews) {
    try {
        await fs.writeFile(REVIEWS_FILE, JSON.stringify(reviews, null, 2), 'utf8');
    } catch (err) {
        console.error('Ошибка записи reviews.json:', err);
        throw err;
    }
}

app.get('/api/reviews', async (_, res) => {
    try {
        const reviews = await readReviews();
        // сортировка по дате descending (новые сверху)
        reviews.sort((a, b) => new Date(b.date) - new Date(a.date));
        res.json(reviews);
    } catch {
        res.json([]);
    }
});

app.post('/api/reviews', async (req, res) => {
    const { name, rating, text } = req.body;

    if (!name || !rating || !text) {
        return res.json({ success: false });
    }

    try {
        let reviews = await readReviews();

        const newReview = {
            id: Date.now(), // простой уникальный id
            name: name.trim(),
            rating: Number(rating),
            text: text.trim(),
            date: new Date().toISOString()
        };

        reviews.push(newReview);
        await writeReviews(reviews);

        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка добавления отзыва:', err);
        res.json({ success: false });
    }
});

app.delete('/api/reviews/:id', async (req, res) => {
    try {
        let reviews = await readReviews();
        const id = Number(req.params.id);

        reviews = reviews.filter(r => r.id !== id);

        await writeReviews(reviews);
        res.json({ success: true });
    } catch {
        res.json({ success: false });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\nVB BUILD LLC — сервер работает на порту ${PORT}`);
    console.log('Отзывы хранятся в reviews.json\n');
});
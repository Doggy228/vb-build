require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const cors = require('cors');
const { v2: cloudinary } = require('cloudinary');

const app = express();
const PORT = process.env.PORT || 3000;

// === АДМИН ПАРОЛЬ (ОБЯЗАТЕЛЬНО ИЗ .env) ===
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim();
if (!ADMIN_PASSWORD) {
    console.error('ОШИБКА: ADMIN_PASSWORD не задан в .env или Environment Variables!');
    process.exit(1);
}

console.log('Админ-пароль загружен:', ADMIN_PASSWORD); // для дебага

const FORMSPREE_ID = process.env.FORMSPREE_ID || 'xanlrjqb';
const CLOUDINARY_URL = process.env.CLOUDINARY_URL;

// Cloudinary
if (CLOUDINARY_URL) {
    cloudinary.config({ cloudinary_url: CLOUDINARY_URL });
}

// === ПАПКИ ===
const IMAGES_DIR = path.join(__dirname, 'images');
const REVIEWS_FILE = path.join(__dirname, 'reviews.json');

// === ИНИЦИАЛИЗАЦИЯ ===
(async () => {
    await fs.mkdir(IMAGES_DIR, { recursive: true }).catch(() => {});
    try {
        await fs.access(REVIEWS_FILE);
    } catch {
        await fs.writeFile(REVIEWS_FILE, '[]', 'utf8');
        console.log('reviews.json создан');
    }
})();

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

// === АДМИН ЛОГИН (ИСПРАВЛЕННЫЙ) ===
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body || {};
    const inputPass = (password || '').toString().trim();

    console.log('Попытка входа:', { inputPass, expected: ADMIN_PASSWORD });

    if (inputPass === ADMIN_PASSWORD) {
        console.log('АДМИН УСПЕШНО ВОШЁЛ');
        res.json({ success: true });
    } else {
        console.log('НЕВЕРНЫЙ ПАРОЛЬ');
        res.json({ success: false });
    }
});

// === CONTACT FORM ===
app.post('/api/contact', async (req, res) => {
    const { name, email, phone, message } = req.body;
    if (!name || !email || !phone || !message) {
        return res.status(400).json({ success: false });
    }

    try {
        const response = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, phone, message })
        });

        if (response.ok) {
            res.json({ success: true });
        } else {
            res.status(500).json({ success: false });
        }
    } catch (err) {
        console.error('Formspree error:', err);
        res.status(500).json({ success: false });
    }
});

// === ОСТАЛЬНЫЕ МАРШРУТЫ (без изменений) ===
app.get('/api/images', async (req, res) => {
    try {
        const files = await fs.readdir(IMAGES_DIR);
        const images = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
        res.json(images);
    } catch (err) {
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
                quality: 'auto'
            });
            url = result.secure_url;
            await fs.unlink(req.file.path).catch(() => {});
        }
        res.json({ success: true, url });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.delete('/api/delete/:filename', async (req, res) => {
    const filePath = path.join(IMAGES_DIR, req.params.filename);
    await fs.unlink(filePath).catch(() => {});
    res.json({ success: true });
});

app.get('/api/reviews', async (req, res) => {
    try {
        const data = await fs.readFile(REVIEWS_FILE, 'utf8');
        res.json(JSON.parse(data));
    } catch (err) {
        res.status(500).json([]);
    }
});

app.post('/api/reviews', async (req, res) => {
    const { name, rating, text } = req.body;
    if (!name || !rating || !text) return res.status(400).json({ success: false });

    try {
        const data = await fs.readFile(REVIEWS_FILE, 'utf8');
        const reviews = JSON.parse(data || '[]');
        reviews.push({ name: name.trim(), rating: +rating, text: text.trim(), date: new Date().toISOString() });
        await fs.writeFile(REVIEWS_FILE, JSON.stringify(reviews, null, 2));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.delete('/api/reviews/:index', async (req, res) => {
    const index = parseInt(req.params.index, 10);
    if (isNaN(index)) return res.status(400).json({ success: false });

    try {
        const data = await fs.readFile(REVIEWS_FILE, 'utf8');
        const reviews = JSON.parse(data || '[]');
        if (index >= 0 && index < reviews.length) {
            reviews.splice(index, 1);
            await fs.writeFile(REVIEWS_FILE, JSON.stringify(reviews, null, 2));
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.get('/sitemap.xml', async (req, res) => {
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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`СЕРВЕР РАБОТАЕТ: localhost:3000`);
    
});
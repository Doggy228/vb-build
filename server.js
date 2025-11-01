// server.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = 3000;

// === ПАРОЛЬ ПРЯМО В КОДЕ (без хеша) ===
const ADMIN_PASSWORD = 'kateunder'; // ← Введи сюда любой пароль

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));
app.use('/images', express.static(path.join(__dirname, 'images')));

const IMAGES_DIR = path.join(__dirname, 'images');
const REVIEWS_FILE = path.join(__dirname, 'reviews.json');

if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(REVIEWS_FILE)) fs.writeFileSync(REVIEWS_FILE, '[]', 'utf8');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, IMAGES_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
        cb(null, name);
    }
});
const upload = multer({ storage });

// === API: АДМИН ВХОД (ПРОСТОЕ СРАВНЕНИЕ) ===
app.post('/api/admin/login', (req, res) => {
    let password = (req.body.password || '').trim();

    if (!password) {
        console.log('[ADMIN] Попытка входа: пустой пароль');
        return res.status(400).json({ success: false });
    }

    const match = password === ADMIN_PASSWORD;

    console.log(`[ADMIN] Ввод: "${password}" → ${match ? 'УСПЕХ' : 'ОТКАЗ'}`);

    res.json({ success: match });
});

// === API: ГАЛЕРЕЯ ===
app.get('/api/images', (req, res) => {
    fs.readdir(IMAGES_DIR, (err, files) => {
        if (err) return res.status(500).json([]);
        const images = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
        res.json(images);
    });
});

app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false });
    res.json({ success: true, filename: req.file.filename });
});

app.delete('/api/delete/:filename', (req, res) => {
    const filePath = path.join(IMAGES_DIR, req.params.filename);
    fs.unlink(filePath, err => {
        res.json({ success: !err });
    });
});

// === API: ОТЗЫВЫ ===
app.get('/api/reviews', (req, res) => {
    fs.readFile(REVIEWS_FILE, 'utf8', (err, data) => {
        if (err) return res.status(500).json([]);
        try { res.json(JSON.parse(data)); } catch (e) { res.status(500).json([]); }
    });
});

app.post('/api/reviews', (req, res) => {
    const { name, rating, text } = req.body;
    if (!name || !rating || !text) return res.status(400).json({ success: false });

    fs.readFile(REVIEWS_FILE, 'utf8', (err, data) => {
        let reviews = err ? [] : JSON.parse(data || '[]');
        reviews.push({ name: name.trim(), rating: +rating, text: text.trim(), date: new Date().toISOString() });
        fs.writeFile(REVIEWS_FILE, JSON.stringify(reviews, null, 2), err => {
            res.json({ success: !err });
        });
    });
});

app.delete('/api/reviews/:index', (req, res) => {
    const index = parseInt(req.params.index, 10);
    if (isNaN(index)) return res.status(400).json({ success: false });

    fs.readFile(REVIEWS_FILE, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ success: false });
        let reviews = [];
        try { reviews = JSON.parse(data); } catch (e) { return res.status(500).json({ success: false }); }
        if (index < 0 || index >= reviews.length) return res.status(400).json({ success: false });

        reviews.splice(index, 1);
        fs.writeFile(REVIEWS_FILE, JSON.stringify(reviews, null, 2), err => {
            res.json({ success: !err });
        });
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
    console.log(`Админ-пароль: ${ADMIN_PASSWORD} (прямо в коде)`);
});
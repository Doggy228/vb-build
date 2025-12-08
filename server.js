const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { v2: cloudinary } = require('cloudinary');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3000;

// Всё берётся безопасно из переменных окружения Render
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();
const DATABASE_URL   = process.env.DATABASE_URL;
const CLOUDINARY_URL = process.env.CLOUDINARY_URL || '';
const FORMSPREE_ID   = process.env.FORMSPREE_ID || 'xanlrjqb';

if (!ADMIN_PASSWORD || !DATABASE_URL) {
    console.error('ОШИБКА: проверь ADMIN_PASSWORD и DATABASE_URL в Render → Environment');
    process.exit(1);
}

// Подключение к Aiven PostgreSQL
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Автоматически создаём таблицу reviews при первом запуске
(async () => {
    try {
        await pool.query('SELECT 1');
        console.log('Aiven PostgreSQL — подключено успешно');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS reviews (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                text TEXT NOT NULL,
                date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);
        console.log('Таблица reviews готова (создана автоматически)');
    } catch (err) {
        console.error('Ошибка при создании таблицы:', err.message);
    }
})();

// Cloudinary (если есть)
if (CLOUDINARY_URL) {
    cloudinary.config({ cloudinary_url: CLOUDINARY_URL });
    console.log('Cloudinary подключён');
}

// Папка для локальных фото
const IMAGES_DIR = path.join(__dirname, 'images');
fs.mkdir(IMAGES_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));
app.use('/images', express.static(IMAGES_DIR));

// Загрузка фото
const upload = multer({
    storage: multer.diskStorage({
        destination: (_, __, cb) => cb(null, IMAGES_DIR),
        filename: (_, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random()*1E9) + path.extname(file.originalname))
    }),
    limits: { fileSize: 10*1024*1024 },
    fileFilter: (_, file, cb) => /\.(jpe?g|png|gif|webp)$/i.test(file.originalname) ? cb(null,true) : cb(new Error('image'))
});

// Роуты
app.post('/api/admin/login', (req,res) => 
    res.json({success: req.body.password?.trim() === ADMIN_PASSWORD}));

app.post('/api/contact', async (req,res) => {
    const {name,email,phone,message} = req.body;
    if (!name||!email||!phone||!message) return res.status(400).json({success:false});
    try {
        const r = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({name,email,phone,message})
        });
        res.json({success:r.ok});
    } catch { res.status(500).json({success:false}); }
});

app.get('/api/images', async (_,res) => {
    try { res.json((await fs.readdir(IMAGES_DIR)).filter(f=>/\.(jpe?g|png|gif|webp)$/i.test(f)));
    } catch { res.json([]); }
});

app.post('/api/upload', upload.single('image'), async (req,res) => {
    if (!req.file) return res.status(400).json({success:false});
    try {
        let url = `/images/${req.file.filename}`;
        if (CLOUDINARY_URL) {
            const up = await cloudinary.uploader.upload(req.file.path, {folder:'vb-buildllc', quality:'auto', fetch_format:'auto'});
            url = up.secure_url;
            await fs.unlink(req.file.path).catch(()=>{});
        }
        res.json({success:true, url});
    } catch { res.status(500).json({success:false}); }
});

app.delete('/api/delete/:f', async (req,res) => {
    await fs.unlink(path.join(IMAGES_DIR, req.params.f)).catch(()=>{});
    res.json({success:true});
});

app.get('/api/reviews', async (_,res) => {
    try {
        const {rows} = await pool.query('SELECT id,name,rating,text,TO_CHAR(date,\'YYYY-MM-DD\') as date FROM reviews ORDER BY date DESC');
        res.json(rows);
    } catch { res.json([]); }
});

app.post('/api/reviews', async (req,res) => {
    const {name,rating,text} = req.body;
    if (!name||!rating||!text) return res.json({success:false});
    try {
        await pool.query('INSERT INTO reviews (name,rating,text) VALUES ($1,$2,$3)', [name.trim(), +rating, text.trim()]);
        res.json({success:true});
    } catch { res.json({success:false}); }
});

app.delete('/api/reviews/:id', async (req,res) => {
    try { await pool.query('DELETE FROM reviews WHERE id=$1', [req.params.id]); res.json({success:true}); }
    catch { res.json({success:false}); }
});

app.get('/sitemap.xml',(_,res)=>{res.header('Content-Type','application/xml');res.send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://vb-buildllc.onrender.com/</loc></url></urlset>`);});
app.get('/robots.txt',(_,res)=>{res.type('text/plain');res.send('User-agent: *\nAllow: /\nSitemap: https://vb-buildllc.onrender.com/sitemap.xml');});

app.listen(PORT, '0.0.0.0', () => {
    console.log('\nVB BUILD LLC — сервер запущен и готов к работе!');
    console.log(`База: Aiven PostgreSQL (Free) — таблица создаётся автоматически\n`);
});
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { v2: cloudinary } = require('cloudinary');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();
const DATABASE_URL   = process.env.DATABASE_URL?.trim();

if (!ADMIN_PASSWORD || !DATABASE_URL) {
    console.error('ОШИБКА: ADMIN_PASSWORD и DATABASE_URL обязательны!');
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL.replace('sslmode=require', 'sslmode=no-verify'),
    ssl: { rejectUnauthorized: false }
});

(async () => {
    try {
        const client = await pool.connect();
        console.log('Подключено к Aiven PostgreSQL');

        await client.query(`
            CREATE TABLE IF NOT EXISTS reviews (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                text TEXT NOT NULL,
                date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);
        console.log('Таблица reviews создана успешно!');
        client.release();
    } catch (err) {
        console.error('Ошибка базы:', err.message);
    }
})();

// Остальной код без изменений...
if (process.env.CLOUDINARY_URL) {
    cloudinary.config({ cloudinary_url: process.env.CLOUDINARY_URL });
}

const IMAGES_DIR = path.join(__dirname, 'images');
fs.mkdir(IMAGES_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));
app.use('/images', express.static(IMAGES_DIR));

const upload = multer({
    storage: multer.diskStorage({
        destination: (_, __, cb) => cb(null, IMAGES_DIR),
        filename: (_, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random()*1E9) + path.extname(file.originalname))
    }),
    limits: { fileSize: 10*1024*1024 }
});

app.post('/api/admin/login', (req,res) => res.json({success: req.body.password?.trim()===ADMIN_PASSWORD}));

app.post('/api/contact', async (req,res) => {
    const {name,email,phone,message} = req.body;
    if (!name||!email||!phone||!message) return res.status(400).json({success:false});
    try {
        const r = await fetch(`https://formspree.io/f/${process.env.FORMSPREE_ID || 'xanlrjqb'}`, {
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
        if (process.env.CLOUDINARY_URL) {
            const up = await cloudinary.uploader.upload(req.file.path, {folder:'vb-buildllc'});
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
    } catch (err) {
        console.error('GET error:', err.message);
        res.json([]);
    }
});

app.post('/api/reviews', async (req,res) => {
    const {name,rating,text} = req.body;
    if (!name||!rating||!text) return res.json({success:false});
    try {
        await pool.query('INSERT INTO reviews (name,rating,text) VALUES ($1,$2,$3)', [name.trim(), +rating, text.trim()]);
        res.json({success:true});
    } catch (err) {
        console.error('INSERT error:', err.message);
        res.json({success:false});
    }
});

app.delete('/api/reviews/:id', async (req,res) => {
    try { await pool.query('DELETE FROM reviews WHERE id=$1', [req.params.id]); res.json({success:true}); }
    catch { res.json({success:false}); }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('\nVB BUILD LLC — сервер работает!');
    console.log('База Aiven — всё подключено\n');
});
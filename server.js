const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_PASSWORD = 'kateunder';
const EMAIL_USER = 'vbbuildllc@gmail.com';
const EMAIL_PASS = 'raro nwos pdcv vlbs'; // УКАЖИ App Password от Gmail

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

// === EMAIL TRANSPORTER ===
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
    }
});

// === CONTACT FORM ENDPOINT ===
app.post('/api/contact', async (req, res) => {
    const { name, email, phone, message } = req.body;
    if (!name || !email || !phone || !message) {
        return res.status(400).json({ success: false });
    }

    const mailOptions = {
        from: EMAIL_USER,
        to: EMAIL_USER,
        replyTo: email,
        subject: `New Contact Form: ${name}`,
        text: `
Name: ${name}
Email: ${email}
Phone: ${phone}

Message:
${message}
        `.trim()
    };

    try {
        await transporter.sendMail(mailOptions);
        res.json({ success: true });
    } catch (err) {
        console.error('Email error:', err);
        res.status(500).json({ success: false });
    }
});

// === Остальные маршруты (admin, images, reviews) ===
app.post('/api/admin/login', (req, res) => {
    const password = (req.body.password || '').trim();
    const match = password === ADMIN_PASSWORD;
    res.json({ success: match });
});

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

app.get('/sitemap.xml', async (req, res) => {
    try {
        const files = await fs.promises.readdir(IMAGES_DIR);
        const imageFiles = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
        const today = new Date().toISOString().split('T')[0];

        let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">`;

        const pages = [
            { loc: '', priority: '1.0', changefreq: 'weekly', images: ['hero.jpg'] },
            { loc: '#about', priority: '0.9', changefreq: 'monthly' },
            { loc: '#work', priority: '0.9', changefreq: 'weekly', images: ['after1.jpg', 'after2.jpg', 'after3.jpg'] },
            { loc: '#gallery', priority: '0.9', changefreq: 'daily' },
            { loc: '#contact-us', priority: '0.9', changefreq: 'daily' },
            { loc: '#reviews', priority: '0.7', changefreq: 'daily' },
            { loc: '#contact', priority: '0.8', changefreq: 'monthly' },
        ];

        for (const page of pages) {
            xml += `\n  <url>
    <loc>https://vb-buildllc.onrender.com/${page.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>`;

            if (page.images) {
                for (const img of page.images) {
                    if (imageFiles.includes(img)) {
                        xml += `\n    <image:image>
      <image:loc>https://vb-buildllc.onrender.com/images/${img}</image:loc>
      <image:title>VB Build LLC Renovation Project</image:title>
    </image:image>`;
                    }
                }
            }

            xml += `\n  </url>`;
        }

        xml += '\n</urlset>';
        res.header('Content-Type', 'application/xml');
        res.send(xml);
    } catch (err) {
        res.status(500).send('Sitemap error');
    }
});

app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send(`User-agent: *
Allow: /

Sitemap: https://vb-buildllc.onrender.com/sitemap.xml`);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен: https://vb-buildllc.onrender.com`);
});
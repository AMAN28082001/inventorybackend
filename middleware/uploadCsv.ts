import multer from 'multer';
import path from 'path';
import fs from 'fs';

const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'csv-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const csvFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const okMime =
    file.mimetype === 'text/csv' ||
    file.mimetype === 'application/csv' ||
    file.mimetype === 'application/vnd.ms-excel' ||
    file.mimetype === 'text/plain';

  if (ext === '.csv' && okMime) {
    cb(null, true);
    return;
  }
  cb(new Error('Only .csv files are allowed for import'));
};

const uploadCsv = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_CSV_FILE_SIZE || String(10 * 1024 * 1024), 10)
  },
  fileFilter: csvFilter
});

export default uploadCsv;

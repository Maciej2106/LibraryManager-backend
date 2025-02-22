import { promises as fs } from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'db.json');
let db; 

const loadDB = async() => {
    try {
        const data = await fs.readFile(dbPath, 'utf8');
        db = JSON.parse(data);
        console.log("Baza danych załadowana.");
    } catch (error) {
        console.error("Błąd ładowania bazy danych:", error);
        process.exit(1); // Zatrzymujemy serwer w przypadku błędu ładowania bazy danych
    }
}

loadDB(); 

export const writeDB = async(data) => { 
    try {
        await fs.writeFile(dbPath, JSON.stringify(data, null, 2));
        console.log("Dane zapisane do bazy danych.");
        db = data; 
    } catch (error) {
        console.error("Błąd zapisu do bazy danych:", error);
        throw error; 
    }
}

export const logAction = async(action, user) => {
    const logEntry = {
        timestamp: new Date().toISOString(),
        user: user ? `${user.email} (${user.role})` : 'Unknown',
        action
    };

    try {
        const data = await fs.readFile(dbPath, 'utf8'); 
        let db = JSON.parse(data); 

        if (!Array.isArray(db.logs)) {
            db.logs = [];
        }

        db.logs.push(logEntry);

        await writeDB(db); 
        console.log("Log został zapisany.");
    } catch (error) {
        console.error("Błąd zapisu logu:", error);
    }
}

export const authenticate = async(req, res, next) => {
    const { authorization } = req.headers;

    if (!authorization) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const token = authorization.split(' ')[1];

    jwt.verify(token, 'secretKey', (err, decoded) => { 
        if (err) {
            return res.status(403).json({ message: 'Invalid token' });
        }

        
        const user = db.users.find((u) => u.id === decoded.userId); 

        if (!user) {
            return res.status(403).json({ message: 'User not found' });
        }

        req.user = user; 
        console.log("✅ Użytkownik autoryzowany:", req.user);
        next();
    });
}

export const authorize = (role) => {
    return (req, res, next) => {
        if (!req.user || req.user.role !== role) { 
            return res.status(403).json({ message: 'Forbidden' });
        }
        next();
    };
}
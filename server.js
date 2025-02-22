import jsonServer from 'json-server';
import bcrypt from 'bcrypt';
import { logAction, authenticate, authorize, writeDB } from './middleware.js';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid'; 
import path from 'path';
import fs from 'fs/promises'; 
import { fileURLToPath } from 'url';

const server = jsonServer.create();
const router = jsonServer.router('db.json');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'db.json');

server.use(cors({
    origin: 'http://localhost:5173', 
    credentials: true, 
    allowedHeaders: ['Authorization', 'Content-Type'], 
    exposedHeaders: ['Authorization'] 
}));
server.use(jsonServer.bodyParser);
server.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ message: 'Missing fields' });
    }
    try {
        const data = await fs.readFile(dbPath, 'utf8');
        const db = JSON.parse(data);
        if (!Array.isArray(db.users)) {
            db.users = [];
        }
        if (db.users.some(u => u.email === email)) {
            return res.status(400).json({ message: 'User already exists' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = {
            id: uuidv4(),
            name,
            email,
            password: hashedPassword,
            role: 'Client',
            libraryCardId: `CARD-${Date.now()}`
        };
        db.users.push(newUser);
        await writeDB(db); 
        logAction('Registration', newUser);
        res.status(201).json(newUser);
    } catch (error) {
        console.error("❌ Błąd podczas rejestracji:", error);
        res.status(500).json({ message: 'Błąd serwera podczas rejestracji' });
    }
});
server.post('/login', async (req, res) => {
    console.log("Otrzymano żądanie logowania:", req.body);
    const { libraryCardId, password } = req.body;
    if (!libraryCardId || !password) {
        return res.status(400).json({ message: 'Missing credentials' });
    }
    try {
        const data = await fs.readFile(dbPath, 'utf8');
        const db = JSON.parse(data);
        const user = db.users.find(u => u.libraryCardId === libraryCardId);
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        const token = jwt.sign({ userId: user.id, role: user.role }, 'secretKey', { expiresIn: '1h' }); 
        logAction('Login', user);
        res.setHeader('Authorization', `Bearer ${token}`); 
        res.json({
            token,
            user: {
                id: user.id,
                role: user.role.toUpperCase(),
                libraryCardId: user.libraryCardId,
                name: user.name,
                email: user.email
            }
        });
    } catch (error) {
        console.error("Błąd podczas logowania:", error);
        res.status(500).json({ message: 'Błąd serwera podczas logowania' });
    }
});
server.get('/rentals', authenticate, (req, res) => {
    const db = router.db.getState();
    if (req.user.role === 'Admin') {
        return res.json(db.rentals);
    }
    if (req.user.role === 'Client') {
        const userRentals = db.rentals.filter(rental => rental.userId === req.user.id);
        return res.json(userRentals);
    }    
    res.status(403).json({ message: "Forbidden" });
});
server.patch('/rentals/:id', authenticate, async (req, res) => {
    try {
        const db = router.db.getState();
        const rentalId = req.params.id;
        const rentalIndex = db.rentals.findIndex(r => r.id === rentalId);
        if (rentalIndex === -1) {
            return res.status(404).json({ message: 'Rental not found' });
        }
        const rental = db.rentals[rentalIndex];
        const bookId = rental.bookId;
        // Zabezpieczenie przed ponownym zwróceniem:
        if (rental.status === 'Returned') {
            return res.status(400).json({ message: 'Book already returned' });
        }
        // 1. Aktualizacja wypożyczenia
        try {
            rental.status = 'Returned';
            rental.returnDate = new Date().toISOString();
            await router.db.write();
        } catch (rentalError) {
            console.error("Błąd aktualizacji wypożyczenia:", rentalError);
            return res.status(500).json({ message: 'Error updating rental' });
        }
        // 2. Aktualizacja książki
        try {
            const book = db.books.find(b => b.id === bookId);
            if (!book) {
                return res.status(404).json({ message: 'Book not found' });
            }
            book.availableCopies++;
            await router.db.write();
        } catch (bookError) {
            console.error("Błąd aktualizacji książki:", bookError);
            return res.status(500).json({ message: 'Error updating book' });
        }
        return res.json(rental);
    } catch (error) {
        console.error("Błąd zwrotu książki:", error);
        return res.status(500).json({ message: 'Server error during return' });
    }
});
server.post('/rentals', authenticate, async (req, res) => {
    try {
        const db = router.db.getState();
        const bookId = req.body.bookId;
        const book = db.books.find(b => b.id === bookId);
        if (!book) {
            return res.status(404).json({ message: "Książka nie znaleziona." });
        }
        if (book.availableCopies <= 0) {
            return res.status(400).json({ message: "Książka niedostępna." });
        }
        const rentalDate = new Date().toISOString().slice(0, 10);
        const returnDate = new Date();
        returnDate.setDate(returnDate.getDate() + 14);
        const returnDateFormatted = returnDate.toISOString().slice(0, 10);
        const newRental = {
            ...req.body,
            id: uuidv4(),
            userId: req.user.id,
            rentalDate: rentalDate,
            returnDate: returnDateFormatted,
            status: "Borrowed"
        };
        // Aktualizacja książki
        book.availableCopies--;
        // Aktualizacja wypożyczeń
        db.rentals.push(newRental);
        // Zapis do pliku
        await router.db.write();
        res.status(201).json(newRental);
    } catch (error) {
        console.error("Błąd podczas dodawania wypożyczenia:", error);
        res.status(500).json({ message: "Wystąpił błąd serwera." });
    }
});
// Endpoint /books - DOSTĘPNY PUBLICZNIE (bez autoryzacji)
server.get('/books', (req, res) => {
    const db = router.db.getState();
    res.json(db.books);
});
//Zabezpieczone trasy
server.use('/logs', authenticate, authorize('Admin'), (req, res, next) => {
     logAction('View Logs', req.user);
     next();
 });
server.get('/logs', authenticate, authorize('Admin'), async (req, res) => {
    try {
        const data = await fs.readFile(dbPath, 'utf8');
        const db = JSON.parse(data);
        if (!db.logs || !Array.isArray(db.logs)) { // Sprawdzenie, czy logs istnieją i są tablicą
            return res.status(200).json([]); // Zwracamy pustą tablicę, jeśli logi nie istnieją
        }
        res.json(db.logs); 
    } catch (error) {
        console.error("Błąd odczytu logów:", error);
        res.status(500).json({ message: 'Błąd serwera podczas pobierania logów' });
    }
});
// Podłączenie routingu JSON-server
server.use(router);
server.use(authenticate, (req, res, next) => {
    logAction(`${req.method} ${req.path}, req.user`);
    next();
});
server.use((err, req, res, next) => {
    console.error(err.stack); // Logujemy stack trace błędu
    res.status(500).json({ message: 'Coś poszło nie tak!' }); 
});
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`JSON Server is running on http://localhost:${PORT}`);
});
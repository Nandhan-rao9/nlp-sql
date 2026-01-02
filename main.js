import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = import.meta.env.VITE_GEMINI_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

let db, schema = "", SQL_ENGINE, lastResult = null;

const runBtn = document.getElementById('runBtn');
const userInput = document.getElementById('userInput');
const badge = document.getElementById('badge');
const sqlText = document.getElementById('sqlText');
const mainTable = document.getElementById('mainTable');
const rowCount = document.getElementById('rowCount');
const exportBtn = document.getElementById('exportBtn');

// Initialize DB Engine
async function init() {
    SQL_ENGINE = await initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.wasm` });
    loadDummy();
}

// Data Sanitization Helper
function sanitizeHeaders(row) {
    const cleanObj = {};
    Object.keys(row).forEach(key => {
        // Remove hidden characters and spaces from keys
        const cleanKey = key.replace(/[^\w\s]/gi, '').trim();
        cleanObj[cleanKey] = row[key];
    });
    return cleanObj;
}

// Robust Database Setup
async function setupDB(data, rawCols) {
    db = new SQL_ENGINE.Database();
    
    // Sanitize columns: No spaces or special chars for the SQL engine
    const cleanCols = rawCols.map(c => c.replace(/[^\w\s]/gi, '').trim());
    schema = cleanCols.join(", ");
    
    const colSchema = cleanCols.map(c => `"${c}" TEXT`).join(", ");
    db.run(`CREATE TABLE user_data (${colSchema})`);
    
    const placeholders = cleanCols.map(() => "?").join(",");
    const stmt = db.prepare(`INSERT INTO user_data VALUES (${placeholders})`);
    
    data.forEach(row => {
        const sanitizedRow = sanitizeHeaders(row);
        const values = cleanCols.map(c => sanitizedRow[c] ?? null);
        stmt.run(values);
    });
    stmt.free();

    badge.innerText = "Premium Engine Active";
    badge.className = "px-4 py-1.5 rounded-full bg-indigo-100 text-[10px] font-bold uppercase text-indigo-700";
    renderTable("SELECT * FROM user_data LIMIT 15");
}

// NLP Execution
runBtn.onclick = async () => {
    const question = userInput.value.trim();
    if (!question || !db) return;

    badge.innerText = "Analyzing...";
    badge.classList.add('animate-pulse');

    try {
        const prompt = `Convert to SQLite. Table:'user_data', Columns:[${schema}]. Output RAW SQL ONLY. No markdown. Query: "${question}"`;
        const result = await model.generateContent(prompt);
        let sql = result.response.text().trim().replace(/```sql|```/gi, "").replace(/;/g, "");

        sqlText.innerText = "SQL: " + sql;
        sqlText.classList.remove('hidden');
        renderTable(sql);
        
        badge.innerText = "Analysis Success";
        badge.classList.remove('animate-pulse');
    } catch (err) {
        badge.innerText = "API Error";
        badge.className = "px-4 py-1.5 rounded-full bg-red-100 text-red-600 font-bold text-[10px]";
        console.error(err);
    }
};

// UI & Export Logic
function renderTable(sql) {
    try {
        const res = db.exec(sql);
        if (!res.length) { 
            mainTable.innerHTML = "<tr><td class='p-10 text-center text-slate-400'>No results. Check column names.</td></tr>"; 
            rowCount.innerText = "0 ROWS";
            exportBtn.classList.add('hidden');
            return; 
        }
        const { columns, values } = res[0];
        rowCount.innerText = `${values.length} ROWS`;
        exportBtn.classList.remove('hidden');
        lastResult = { columns, values };

        let html = `<thead><tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>`;
        values.forEach(row => html += `<tr>${row.map(v => `<td>${v ?? ''}</td>`).join('')}</tr>`);
        mainTable.innerHTML = html + "</tbody>";
    } catch (e) {
        mainTable.innerHTML = `<tr><td class="p-10 text-red-500 font-mono text-xs">${e.message}</td></tr>`;
    }
}

exportBtn.onclick = () => {
    if (!lastResult) return;
    const csv = Papa.unparse(lastResult.values.map(row => {
        let obj = {};
        lastResult.columns.forEach((col, i) => obj[col] = row[i]);
        return obj;
    }));
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nlp_export_${Date.now()}.csv`;
    a.click();
};

// File Handlers with better Parsing
document.getElementById('fileInput').onchange = (e) => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = (ev) => {
        if (file.name.endsWith('.csv')) {
            Papa.parse(ev.target.result, {
                header: true,
                skipEmptyLines: true,
                transformHeader: h => h.replace(/[^\w\s]/gi, '').trim(),
                complete: (r) => setupDB(r.data, r.meta.fields)
            });
        } else {
            const wb = XLSX.read(ev.target.result, { type: 'binary' });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
            if (json.length > 0) {
                const cols = Object.keys(json[0]);
                setupDB(json, cols);
            }
        }
    };
    file.name.endsWith('.csv') ? reader.readAsText(file) : reader.readAsBinaryString(file);
};

function loadDummy() {
    setupDB([{ ID: "1", Product: "Sample", Sales: "500" }], ["ID", "Product", "Sales"]);
}
document.getElementById('loadDummy').onclick = loadDummy;

init();
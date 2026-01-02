import { GoogleGenerativeAI } from "@google/generative-ai";

// 1. Setup API with the 2026 Gemini 2.5 Model
const API_KEY = import.meta.env.VITE_GEMINI_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

let db, schema = "", SQL_ENGINE;

const runBtn = document.getElementById('runBtn');
const userInput = document.getElementById('userInput');
const badge = document.getElementById('badge');
const sqlText = document.getElementById('sqlText');
const mainTable = document.getElementById('mainTable');

// 2. Initialize SQL.js
async function init() {
    SQL_ENGINE = await initSqlJs({ 
        locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.wasm` 
    });
    loadDummy();
}

async function setupDB(data, cols) {
    db = new SQL_ENGINE.Database();
    
    // 1. Clean the column names (Trim whitespace)
    const cleanCols = cols.map(c => c.trim());
    schema = cleanCols.join(", ");
    
    // 2. Wrap column names in double quotes to handle spaces/case-sensitivity
    const colSchema = cleanCols.map(c => `"${c}" TEXT`).join(", ");
    db.run(`CREATE TABLE user_data (${colSchema})`);
    
    // 3. Prepare the insert statement with quotes
    const placeholders = cleanCols.map(() => "?").join(",");
    const stmt = db.prepare(`INSERT INTO user_data VALUES (${placeholders})`);
    
    data.forEach(row => {
        // Match the data to the cleaned column names
        const values = cleanCols.map(c => row[c] || row[cols[cleanCols.indexOf(c)]] || null);
        stmt.run(values);
    });
    stmt.free();

    badge.innerText = "Engine Ready";
    badge.className = "px-4 py-1.5 rounded-full bg-emerald-100 text-[10px] font-bold uppercase text-emerald-600";
    renderTable("SELECT * FROM user_data LIMIT 15");
}

// 3. The 2026 NLP Logic
runBtn.onclick = async () => {
    const question = userInput.value.trim();
    if (!question || !db) return;

    badge.innerText = "Gemini 2.5 Analyzing...";
    badge.className = "px-4 py-1.5 rounded-full bg-indigo-100 text-[10px] font-bold uppercase text-indigo-600 animate-pulse";

    try {
        const prompt = `Convert to SQLite. Table:'user_data', Columns:[${schema}]. 
                        Return RAW SQL ONLY. No markdown, no comments, no explanation.
                        Query: "${question}"`;

        const result = await model.generateContent(prompt);
        let sql = result.response.text().trim();
        
        // Final polish to remove any accidental markdown
        sql = sql.replace(/```sql|```/gi, "").replace(/;/g, "").trim();

        sqlText.innerText = "SQL: " + sql;
        sqlText.classList.remove('hidden');
        renderTable(sql);

        badge.innerText = "Done";
        badge.className = "px-4 py-1.5 rounded-full bg-emerald-100 text-[10px] font-bold uppercase text-emerald-600";
    } catch (err) {
        console.error(err);
        if (err.message.includes("429")) {
            badge.innerText = "Quota Exceeded (Wait 60s)";
        } else {
            badge.innerText = "API Error";
        }
        badge.className = "px-4 py-1.5 rounded-full bg-red-100 text-[10px] font-bold uppercase text-red-600";
    }
};

// 4. File Parsers
document.getElementById('fileInput').onchange = (e) => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = (ev) => {
        if (file.name.endsWith('.csv')) {
            Papa.parse(ev.target.result, { header: true, complete: (r) => setupDB(r.data, r.meta.fields) });
        } else {
            const wb = XLSX.read(ev.target.result, { type: 'binary' });
            const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
            setupDB(json, Object.keys(json[0]));
        }
    };
    file.name.endsWith('.csv') ? reader.readAsText(file) : reader.readAsBinaryString(file);
};

function loadDummy() {
    const data = [{ Item: "MacBook", Price: 2000 }, { Item: "iPhone", Price: 1000 }, { Item: "iPad", Price: 800 }];
    setupDB(data, Object.keys(data[0]));
}
document.getElementById('loadDummy').onclick = loadDummy;

function renderTable(sql) {
    try {
        // Ensure the SQL uses double quotes for the specific columns mentioned
        const res = db.exec(sql);
        if (!res.length) { 
            mainTable.innerHTML = "<tr><td class='p-10 text-center text-slate-400'>No results found.</td></tr>"; 
            rowCount.innerText = "0 ROWS";
            return; 
        }
        const { columns, values } = res[0];
        rowCount.innerText = `${values.length} ROWS`;
        
        // Render with clean styling
        let html = `<thead><tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>`;
        values.forEach(row => {
            html += `<tr>${row.map(v => `<td>${v === null ? '<span class="text-slate-300">NULL</span>' : v}</td>`).join('')}</tr>`;
        });
        mainTable.innerHTML = html + "</tbody>";
    } catch (e) {
        // If the error is "no such column", the AI likely hallucinated a name.
        // We show the error clearly in the UI so the user knows to rephrase.
        mainTable.innerHTML = `<tr><td class="p-10 text-red-500 font-mono text-xs">
            <strong>Query Error:</strong> ${e.message}<br>
            <span class="text-slate-400">Available columns: ${schema}</span>
        </td></tr>`;
    }
}

init();
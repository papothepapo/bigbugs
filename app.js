// Global variables
let pyodide = null;
let pyodideLoading = false;
let apiKey = localStorage.getItem('openrouter_api_key') || '';
let currentPanel = 'none';
let rssFeeds = [
    'https://feeds.bbci.co.uk/news/rss.xml',
    'https://rss.cnn.com/rss/edition.rss',
    'https://feeds.reuters.com/reuters/topNews'
];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadRSSFeeds();
    if (apiKey) {
        document.getElementById('apiKey').value = apiKey;
    }
});

// API Key Management
function saveApiKey() {
    apiKey = document.getElementById('apiKey').value;
    localStorage.setItem('openrouter_api_key', apiKey);
    showStatus('API key saved!', 'success');
}

// Panel Management
function switchPanel(panel) {
    // Hide all panels
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    // Show selected panel
    if (panel !== 'none') {
        document.getElementById(`${panel}Panel`).classList.add('active');
        document.querySelector(`.tab-btn[onclick="switchPanel('${panel}')"]`).classList.add('active');
    } else {
        document.querySelector('.tab-btn[onclick="switchPanel(\'none\')"]').classList.add('active');
    }
    
    currentPanel = panel;
}

// RSS Functions
async function loadRSSFeeds() {
    const loading = document.getElementById('rssLoading');
    const container = document.getElementById('rssFeeds');
    
    loading.style.display = 'block';
    container.innerHTML = '';
    
    try {
        const allArticles = [];
        
        for (const feedUrl of rssFeeds) {
            const response = await fetch(`https://api.rss2json.com/api.json?rss_url=${encodeURIComponent(feedUrl)}`);
            const data = await response.json();
            
            if (data.status === 'ok') {
                data.items.forEach(item => {
                    allArticles.push({
                        ...item,
                        source: data.feed.title
                    });
                });
            }
        }
        
        // Sort by date
        allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
        
        // Display articles
        allArticles.slice(0, 20).forEach(article => {
            const articleEl = createRSSArticle(article);
            container.appendChild(articleEl);
        });
    } catch (error) {
        console.error('Error loading RSS:', error);
        container.innerHTML = '<div class="status error">Error loading RSS feeds</div>';
    }
    
    loading.style.display = 'none';
}

function createRSSArticle(article) {
    const div = document.createElement('div');
    div.className = 'rss-item';
    
    const date = new Date(article.pubDate).toLocaleDateString();
    
    div.innerHTML = `
        <h3>${article.title}</h3>
        <div class="meta">${article.source} • ${date}</div>
        <p>${article.description ? article.description.substring(0, 200) + '...' : ''}</p>
        <a href="${article.link}" target="_blank">Read more →</a>
    `;
    
    return div;
}

function addRSSFeed() {
    const input = document.getElementById('rssUrl');
    const url = input.value.trim();
    
    if (url && !rssFeeds.includes(url)) {
        rssFeeds.push(url);
        input.value = '';
        loadRSSFeeds();
        showStatus('RSS feed added!', 'success');
    }
}

async function summarizeNews() {
    if (!apiKey) {
        showStatus('Please enter your API key first!', 'error');
        return;
    }
    
    const articles = [];
    document.querySelectorAll('.rss-item').forEach(item => {
        const title = item.querySelector('h3').textContent;
        const desc = item.querySelector('p').textContent;
        articles.push({ title, description: desc });
    });
    
    const prompt = `Please summarize today's news from these articles in a concise, easy-to-read format with key highlights:\n\n${JSON.stringify(articles, null, 2)}`;
    
    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'anthropic/claude-3-haiku',
                messages: [{ role: 'user', content: prompt }]
            })
        });
        
        const data = await response.json();
        
        if (data.choices && data.choices[0]) {
            const summary = data.choices[0].message.content;
            
            // Create summary display
            const container = document.getElementById('rssFeeds');
            const summaryEl = document.createElement('div');
            summaryEl.className = 'rss-item';
            summaryEl.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            summaryEl.style.color = 'white';
            summaryEl.innerHTML = `
                <h3>🤖 AI News Summary</h3>
                <div class="meta" style="color: rgba(255,255,255,0.9)">Generated just now</div>
                <div style="white-space: pre-line; margin-top: 1rem;">${summary}</div>
            `;
            container.insertBefore(summaryEl, container.firstChild);
        }
    } catch (error) {
        console.error('Error summarizing:', error);
        showStatus('Error generating summary', 'error');
    }
}

// YouTube Downloader with Pyodide
async function initPyodide() {
    if (pyodide) return pyodide;
    if (pyodideLoading) return null;
    
    pyodideLoading = true;
    const status = document.getElementById('ytdlpStatus');
    
    showStatus('Loading Python environment...', 'info', 'ytdlpStatus');
    
    try {
        pyodide = await loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.23.0/full/"
        });
        
        showStatus('Installing yt-dlp...', 'info', 'ytdlpStatus');
        await pyodide.loadPackage(['micropip']);
        await pyodide.runPythonAsync(`
            import micropip
            await micropip.install('yt-dlp==2023.7.6')
            import yt_dlp
            import json
            import sys
            from io import BytesIO
            import js
        `);
        
        showStatus('Ready!', 'success', 'ytdlpStatus');
        pyodideLoading = false;
        return pyodide;
    } catch (error) {
        console.error('Error initializing Pyodide:', error);
        showStatus('Error initializing: ' + error.message, 'error', 'ytdlpStatus');
        pyodideLoading = false;
        return null;
    }
}

async function downloadVideo() {
    const url = document.getElementById('videoUrl').value.trim();
    if (!url) {
        showStatus('Please enter a URL', 'error', 'ytdlpStatus');
        return;
    }
    
    const pyodide = await initPyodide();
    if (!pyodide) return;
    
    const progressContainer = document.getElementById('ytdlpProgress');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const preview = document.getElementById('videoPreview');
    
    progressContainer.style.display = 'block';
    preview.innerHTML = '';
    
    // Set up progress hook
    await pyodide.runPythonAsync(`
        def progress_hook(d):
            if d['status'] == 'downloading':
                percent = d.get('_percent_str', '0.0%').strip()
                speed = d.get('_speed_str', '0B/s').strip()
                eta = d.get('_eta_str', 'Unknown').strip()
                
                js.updateDownloadProgress(percent, speed, eta)
            elif d['status'] == 'finished':
                js.downloadComplete(d['filename'])
    `);
    
    // Configure yt-dlp
    await pyodide.runPythonAsync(`
        ydl_opts = {
            'format': 'best[height<=720][filesize<=100M]',
            'outtmpl': '/downloads/%(title)s.%(ext)s',
            'noplaylist': True,
            'progress_hooks': [progress_hook],
            'quiet': True
        }
        
        import os
        os.makedirs('/downloads', exist_ok=True)
    `);
    
    try {
        showStatus('Starting download...', 'info', 'ytdlpStatus');
        
        // Start download
        await pyodide.runPythonAsync(`
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download(['${url}'])
        `);
    } catch (error) {
        console.error('Download error:', error);
        showStatus('Download failed: ' + error.toString(), 'error', 'ytdlpStatus');
        progressContainer.style.display = 'none';
    }
}

// Progress update functions (called from Python)
window.updateDownloadProgress = function(percent, speed, eta) {
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    
    progressFill.style.width = percent;
    progressText.textContent = `${percent} • ${speed} • ETA: ${eta}`;
};

window.downloadComplete = function(filename) {
    const status = document.getElementById('ytdlpStatus');
    const preview = document.getElementById('videoPreview');
    
    showStatus('Download complete!', 'success', 'ytdlpStatus');
    
    // Get file from Pyodide
    pyodide.runPythonAsync(`
        with open('${filename}', 'rb') as f:
            data = f.read()
        js.saveVideo(data, '${filename}')
    `);
};

window.saveVideo = function(data, filename) {
    const blob = new Blob([data], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    
    // Create video preview
    const preview = document.getElementById('videoPreview');
    preview.innerHTML = `
        <video controls>
            <source src="${url}" type="video/mp4">
        </video>
        <a href="${url}" download="${filename}" class="download-link">
            <button style="margin-top: 1rem; width: 100%;">💾 Save Video</button>
        </a>
    `;
};

// Proxy Functions
async function fetchViaProxy() {
    const url = document.getElementById('proxyUrl').value.trim();
    if (!url) {
        showStatus('Please enter a URL', 'error', 'proxyStatus');
        return;
    }
    
    const status = document.getElementById('proxyStatus');
    const content = document.getElementById('proxyContent');
    
    showStatus('Fetching...', 'info', 'proxyStatus');
    
    try {
        // Replace with your Cloudflare Worker URL
        const proxyUrl = 'https://your-proxy.your-subdomain.workers.dev';
        const response = await fetch(`${proxyUrl}?url=${encodeURIComponent(url)}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const contentType = response.headers.get('content-type');
        let data;
        
        if (contentType && contentType.includes('application/json')) {
            data = JSON.stringify(await response.json(), null, 2);
        } else {
            data = await response.text();
        }
        
        content.textContent = data;
        showStatus('Content loaded successfully!', 'success', 'proxyStatus');
    } catch (error) {
        console.error('Proxy error:', error);
        showStatus('Error: ' + error.message, 'error', 'proxyStatus');
        content.textContent = 'Failed to fetch content';
    }
}

// Chat Functions
async function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (!message) return;
    if (!apiKey) {
        showStatus('Please enter your API key first!', 'error', 'chatStatus');
        return;
    }
    
    const messagesContainer = document.getElementById('chatMessages');
    
    // Add user message
    addMessage(message, 'user');
    input.value = '';
    
    // Get chat history
    const messages = getChatHistory();
    messages.push({ role: 'user', content: message });
    
    showStatus('Thinking...', 'info', 'chatStatus');
    
    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'anthropic/claude-3-haiku',
                messages: messages
            })
        });
        
        const data = await response.json();
        
        if (data.choices && data.choices[0]) {
            const reply = data.choices[0].message.content;
            addMessage(reply, 'assistant');
            messages.push({ role: 'assistant', content: reply });
            saveChatHistory(messages);
        }
        
        showStatus('', 'success', 'chatStatus');
    } catch (error) {
        console.error('Chat error:', error);
        showStatus('Error: ' + error.message, 'error', 'chatStatus');
        addMessage('Sorry, I encountered an error. Please try again.', 'assistant');
    }
}

function addMessage(content, role) {
    const container = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = content;
    
    messageDiv.appendChild(contentDiv);
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
}

function getChatHistory() {
    const history = localStorage.getItem('chatHistory');
    return history ? JSON.parse(history) : [];
}

function saveChatHistory(messages) {
    // Keep only last 10 messages to save space
    const lastMessages = messages.slice(-10);
    localStorage.setItem('chatHistory', JSON.stringify(lastMessages));
}

// Utility Functions
function showStatus(message, type, elementId = null) {
    const statusEl = elementId 
        ? document.getElementById(elementId)
        : document.querySelector('.panel.active .status') || document.getElementById('rssStatus');
    
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.className = `status ${type}`;
        
        if (message) {
            statusEl.style.display = 'block';
        } else {
            statusEl.style.display = 'none';
        }
    }
}

// Enter key handlers
document.getElementById('chatInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

document.getElementById('videoUrl').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        downloadVideo();
    }
});

document.getElementById('proxyUrl').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        fetchViaProxy();
    }
});

document.getElementById('rssUrl').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        addRSSFeed();
    }
});

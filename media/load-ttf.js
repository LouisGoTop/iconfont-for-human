// console.log('load-ttf.js')
// Import fonteditor-core. We assume it's loaded globally or via a script tag in load-ttf.html
// If not, you might need to adjust how Font is accessed.
// For example, if load-ttf.html includes <script src="./fonteditor-core.min.js"></script>

window.onload = () => {
    const vscode = acquireVsCodeApi();
    const content = document.querySelector(".content");
    const loading = document.querySelector(".loading"); // Assume you have a loading indicator
    const errorContainer = document.querySelector(".error"); // Assume you have an error display area

    function displayError(message) {
        if (loading) loading.style.display = 'none';
        if (content) content.innerHTML = ''; // Clear content
        if (errorContainer) {
            errorContainer.textContent = `Error: ${message}`;
            errorContainer.style.display = 'block';
        }
        console.error("Font Preview Error:", message);
    }

    window.addEventListener('message', event => {
        const message = event.data; // The JSON data our extension sent

        if (loading) loading.style.display = 'block';
        if (errorContainer) errorContainer.style.display = 'none';
        if (content) content.innerHTML = ''; // Clear previous content

        switch (message.command) {
            case 'loadFont':
                const base64Data = message.data;
                const extension = message.extension; // .ttf, .woff, .woff2 etc.
                const fontPreviewFamily = 'iconfont-preview'; // Unique font family name

                try {
                    // 1. Decode Base64
                    const binaryString = window.atob(base64Data);
                    const len = binaryString.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    const arrayBuffer = bytes.buffer;

                    // 2. Parse font using fonteditor-core
                    const font = Font.create(arrayBuffer, { type: extension.substring(1) }); // Pass type like 'ttf', 'woff'
                    const fontData = font.get();
                    console.log('Parsed font data:', fontData);

                    // Check if parsing was successful (basic check)
                    if (!fontData || !fontData.glyf) {
                        throw new Error('Font parsing failed or font has no glyphs.');
                    }

                    // 3. Inject @font-face style
                    const mimeTypes = {
                        '.ttf': 'font/truetype',
                        '.otf': 'font/opentype',
                        '.woff': 'font/woff',
                        '.woff2': 'font/woff2',
                        '.eot': 'application/vnd.ms-fontobject' // EOT might need different handling
                    };
                    const mimeType = mimeTypes[extension] || 'font/opentype'; // Default guess
                    const fontFaceRule = `
                        @font-face {
                            font-family: '${fontPreviewFamily}';
                            src: url(data:${mimeType};base64,${base64Data});
                        }
                    `;
                    let styleElement = document.getElementById('font-preview-style');
                    if (!styleElement) {
                        styleElement = document.createElement('style');
                        styleElement.id = 'font-preview-style';
                        document.head.appendChild(styleElement);
                    }
                    styleElement.textContent = fontFaceRule;

                    // 4. Get glyph info (adjust based on actual fonteditor-core API)
                    // Let's try getting glyphs with unicode directly
                    const glyphs = font.find({ unicode: true }) || []; // Find glyphs with unicode
                    console.log(`Found ${glyphs.length} glyphs with unicode.`);

                    // Alternative: Iterate through all glyphs if the above doesn't work well
                    // const glyphs = fontData.glyf;

                    // 5. Generate HTML
                    const html = glyphs
                        .filter(g => g && typeof g.unicode === 'number') // Ensure unicode is a number
                        .map(glyph => {
                            const unicodeDecimal = glyph.unicode;
                            const unicodeHex = unicodeDecimal.toString(16).padStart(4, '0');
                            const name = glyph.name || `uni${unicodeHex.toUpperCase()}`;
                            const character = String.fromCharCode(unicodeDecimal);

                            // Use template literal for cleaner HTML structure
                            return `
                                <div class="item">
                                    <div class="icon" style="font-family: '${fontPreviewFamily}';" title="${name} (U+${unicodeHex.toUpperCase()})">${character}</div>
                                    <div class="codepoint-info">
                                         <div class="name" onclick="copyText(this, '${name}')" title="Copy Name">${name}</div>
                                         <div class="unicode" onclick="copyText(this, '&#x${unicodeHex};')" title="Copy HTML Entity">&amp;#x${unicodeHex};</div>
                                         <div class="css-code" onclick="copyText(this, '\\${unicodeHex}')" title="Copy CSS Code">\\${unicodeHex}</div>
                                    </div>
                                </div>
                            `;
                        })
                        .join('\n');

                    if (content) {
                         content.innerHTML = html || '<p>No glyphs with Unicode found to display.</p>';
                    }

                    if (loading) loading.style.display = 'none';

                } catch (error) {
                    displayError(error.message || 'An unknown error occurred during font processing.');
                    console.error(error);
                }
                break;
            case 'loadError': // Handle errors sent from the extension
                 displayError(message.message);
                 break;
        }
    });

    // Send message to extension when webview is ready (optional)
    // vscode.postMessage({ command: 'webviewReady' });
};

// Shared copy function (slightly modified)
function copyText(element, textToCopy) {
    if (!textToCopy) return;
    copyToClipboard(textToCopy);

    // Visual feedback
    const originalText = element.textContent; // Use textContent for display text
    const displayElement = element; // Copy applies to the clicked element
    const originalCursor = displayElement.style.cursor;
    const originalTitle = displayElement.title;

    displayElement.textContent = "Copied!";
    displayElement.style.cursor = "default";
    displayElement.title = "Copied!";

    // Find parent .item and briefly highlight it
    const itemElement = element.closest('.item');
    if (itemElement) {
        itemElement.classList.add('copied-highlight');
    }

    // Temporarily disable onclick to prevent rapid clicks
    const originalOnclick = displayElement.onclick;
    displayElement.onclick = null;

    setTimeout(() => {
        displayElement.textContent = originalText;
        displayElement.onclick = originalOnclick;
        displayElement.style.cursor = originalCursor;
        displayElement.title = originalTitle;
        if (itemElement) {
            itemElement.classList.remove('copied-highlight');
        }
    }, 1000); // Longer timeout for better feedback
}

// Basic copy to clipboard function (remains the same)
function copyToClipboard(content) {
    navigator.clipboard.writeText(content).then(() => {
        console.log('Copied to clipboard:', content);
    }).catch(err => {
        console.error('Failed to copy text: ', err);
        // Fallback for older browsers/contexts if needed (less common in modern webviews)
        try {
             const input = document.createElement('textarea'); // Use textarea for potential newlines
             input.value = content;
             input.style.position = 'absolute';
             input.style.left = '-9999px';
             document.body.appendChild(input);
             input.select();
             document.execCommand('copy');
             document.body.removeChild(input);
             console.log('(Fallback) Copied to clipboard:', content);
        } catch (fallbackErr) {
             console.error('(Fallback) Failed to copy text: ', fallbackErr);
        }
    });
}
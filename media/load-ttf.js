// console.log('load-ttf.js')
// Import fonteditor-core. We assume it's loaded globally or via a script tag in load-ttf.html
// If not, you might need to adjust how Font is accessed.
// For example, if load-ttf.html includes <script src="./fonteditor-core.min.js"></script>
// *** fonteditor-core is no longer needed here ***

window.onload = () => {
  const vscode = acquireVsCodeApi();
  const content = document.querySelector(".content");
  const loading = document.querySelector(".loading"); // Assume you have a loading indicator
  const errorContainer = document.querySelector(".error"); // Assume you have an error display area
  const searchInput = document.getElementById('search-input'); // 获取搜索框

  function displayError(message) {
    if (loading) loading.style.display = 'none';
    if (content) content.innerHTML = ''; // Clear content
    if (errorContainer) {
      errorContainer.textContent = `Error: ${message}`;
      errorContainer.style.display = 'block';
    }
    console.error("Font Preview Error:", message);
  }

  // 筛选函数
  function filterIcons() {
    if (!content || !searchInput) return;

    const searchTerm = searchInput.value.toLowerCase().trim();
    const items = content.querySelectorAll('.item');

    items.forEach(item => {
      const nameElement = item.querySelector('.name');
      const unicodeElement = item.querySelector('.unicode');
      const cssCodeElement = item.querySelector('.css-code');

      // 获取要搜索的文本，确保元素存在
      const nameText = nameElement ? nameElement.textContent.toLowerCase() : '';
      // 从 HTML 实体（&amp;#x...;）中提取十六进制代码进行搜索
      const unicodeHexMatch = unicodeElement ? unicodeElement.textContent.match(/x([0-9a-f]+);/i) : null;
      const unicodeText = unicodeHexMatch ? unicodeHexMatch[1].toLowerCase() : ''; // 提取 hex 部分
      // 从 CSS 代码（\...）中提取十六进制代码
      const cssCodeMatch = cssCodeElement ? cssCodeElement.textContent.match(/\\([0-9a-f]+)/i) : null;
      const cssCodeText = cssCodeMatch ? cssCodeMatch[1].toLowerCase() : ''; // 提取 hex 部分
      // 也可以搜索字符本身
      const iconCharElement = item.querySelector('.icon');
      const iconCharText = iconCharElement ? iconCharElement.textContent.toLowerCase() : '';


      // 检查名称、Unicode 十六进制或 CSS 代码是否包含搜索词
      // 或者搜索词就是图标字符本身
      const isMatch = nameText.includes(searchTerm) ||
                      unicodeText.includes(searchTerm) ||
                      cssCodeText.includes(searchTerm) ||
                      (searchTerm.length === 1 && iconCharText === searchTerm); // 精确匹配单个字符


      // 根据匹配结果显示或隐藏项目
      item.style.display = isMatch ? '' : 'none'; // 使用空字符串恢复默认显示 (block/flex/etc.)
    });
  }

  // 为搜索框添加事件监听器
  if (searchInput) {
    searchInput.addEventListener('input', filterIcons);
  }

  window.addEventListener('message', event => {
    const message = event.data; // The JSON data our extension sent

    if (loading) loading.style.display = 'block';
    if (errorContainer) errorContainer.style.display = 'none';
    if (content) content.innerHTML = ''; // Clear previous content

    switch (message.command) {
      case 'loadFont':
        // 从消息中获取 base64 数据和已解析的字形数据
        const base64Data = message.base64Data;
        const glyphsData = message.glyphsData; // Array of { unicode: number, name: string }
        const extension = message.extension; // .ttf, .woff, .woff2 etc.
        const fontPreviewFamily = 'iconfont-preview'; // Unique font family name

        try {
          // 检查是否收到了有效的字形数据
          if (!base64Data || !Array.isArray(glyphsData)) {
              throw new Error('Invalid font data received from extension.');
          }

          // 3. Inject @font-face style (使用 base64Data)
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

          // 4. 直接使用 glyphsData 生成 HTML
          // const glyphs = font.find({ unicode: true }) || []; // Find glyphs with unicode
          // console.log(`Found ${glyphs.length} glyphs with unicode.`);

          // Alternative: Iterate through all glyphs if the above doesn't work well
          // const glyphs = fontData.glyf;

          // 5. Generate HTML (使用 glyphsData)
          const html = glyphsData
            // .filter(g => g && typeof g.unicode === 'number') // Extension side already filtered
            .map(glyph => {
              const unicodeDecimal = glyph.unicode;
              const unicodeHex = unicodeDecimal.toString(16).padStart(4, '0');
              const name = glyph.name; // name is already provided or generated by extension
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

          // Optional: Apply initial filter if search box has value (e.g., state restoration)
          filterIcons(); // 在加载完内容后调用一次筛选

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
const { app, BrowserWindow, ipcMain, session, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const prompt = require('electron-prompt');
const Store = require('electron-store');

const store = new Store({
  cwd: app.getPath('userData'),
});

const userDataPath = app.getPath('userData');
const channelsFilePath = path.join(userDataPath, 'channels.js');

app.disableHardwareAcceleration();

let mainWindow;
let currentLanguage = store.get('currentLanguage', 'th');
console.log('Initial currentLanguage from store:', currentLanguage);

const CURRENT_VERSION = app.getVersion();
const UPDATE_CHECK_URL = 'https://www.raspihost.com/update.json';

function createMenuTemplate(lang) {
  const translations = {
    th: {
      file: 'ไฟล์',
      importJsFile: 'นำเข้าจากไฟล์ .js',
      importM3UFile: 'นำเข้าจากไฟล์ .m3u',
      importM3UUrl: 'นำเข้าจาก URL .m3u',
      importUrl: 'นำเข้าจาก URL js',
      exportJs: 'ส่งออกเป็นไฟล์ .js',
      exportM3U: 'ส่งออกเป็นไฟล์ .m3u',
      language: 'ภาษา',
      thai: 'ภาษาไทย',
      english: 'English',
      help: 'ช่วยเหลือ',
      about: 'เกี่ยวกับ',
      checkUpdate: 'ตรวจสอบการอัปเดต',
      aboutTitle: 'เกี่ยวกับ IPTV Player',
      aboutMessage: 'IPTV Player v' + CURRENT_VERSION + '\nพัฒนาโดย Son Tong\nห้ามนำไปจำหน่าย',
      ok: 'ตกลง',
      download: 'ดาวน์โหลด',
      cancel: 'ยกเลิก',
    },
    en: {
      file: 'File',
      importJsFile: 'Import from .js File',
      importM3UFile: 'Import from .m3u File',
      importM3UUrl: 'Import from .m3u URL',
      importUrl: 'Import from js URL',
      exportJs: 'Export as .js File',
      exportM3U: 'Export as .m3u File',
      language: 'Language',
      thai: 'Thai',
      english: 'English',
      help: 'Help',
      about: 'About',
      checkUpdate: 'Check for Updates',
      aboutTitle: 'About IPTV Player',
      aboutMessage: 'IPTV Player v' + CURRENT_VERSION + '\nDeveloped by Son Tong\nDo not distribute',
      ok: 'OK',
      download: 'Download',
      cancel: 'Cancel',
    },
  };

  const t = translations[lang];

  const menuTemplate = [
    {
      label: t.file,
      submenu: [
        { label: t.importJsFile, click: importChannelsFromJsFile },
        { label: t.importM3UFile, click: importChannelsFromM3U },
        { label: t.importM3UUrl, click: importChannelsFromM3UUrl },
        { label: t.importUrl, click: importChannelsFromUrl },
        { label: t.exportJs, click: async () => exportChannelsAsJs(require(channelsFilePath)) },
        { label: t.exportM3U, click: async () => exportChannelsAsM3U(require(channelsFilePath)) },
      ],
    },
    {
      label: t.language,
      submenu: [
        { label: t.thai, type: 'radio', checked: lang === 'th', click: () => setLanguage('th') },
        { label: t.english, type: 'radio', checked: lang === 'en', click: () => setLanguage('en') },
      ],
    },
    {
      label: t.help,
      submenu: [
        { label: t.checkUpdate, click: () => checkForUpdatesManual() },
        {
          label: t.about,
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: t.aboutTitle,
              message: t.aboutMessage,
              buttons: [t.ok],
            });
          },
        },
      ],
    },
  ];

  console.log('Menu template created for language:', lang);
  return menuTemplate;
}

function setLanguage(lang) {
  currentLanguage = lang;
  store.set('currentLanguage', lang);
  console.log('Language set and saved to store:', lang);
  const menuTemplate = createMenuTemplate(lang);
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  if (mainWindow) {
    mainWindow.webContents.send('change-language', lang);
  }
}

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  console.log('Preload path:', preloadPath);
  if (!fs.existsSync(preloadPath)) {
    console.error('preload.js not found at:', preloadPath);
    dialog.showErrorBox('Error', 'preload.js not found at: ' + preloadPath);
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      devTools: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.openDevTools();

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('index.html loaded');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const lastChannelsPath = store.get('lastChannelsPath');
  if (lastChannelsPath && fs.existsSync(lastChannelsPath)) {
    try {
      let importedChannels;
      if (lastChannelsPath.endsWith('.js')) {
        importedChannels = require(lastChannelsPath);
      } else if (lastChannelsPath.endsWith('.m3u')) {
        const m3uContent = fs.readFileSync(lastChannelsPath, 'utf-8');
        importedChannels = parseM3U(m3uContent);
      } else if (lastChannelsPath.endsWith('.w3u')) {
        const w3uContent = fs.readFileSync(lastChannelsPath, 'utf-8');
        importedChannels = parseW3U(w3uContent); // เพิ่มการรองรับ .w3u
      } else {
        console.log('Unsupported file type for lastChannelsPath:', lastChannelsPath);
        return;
      }
      fs.writeFileSync(channelsFilePath, `module.exports = ${JSON.stringify(importedChannels, null, 2)};`);
      mainWindow.webContents.send('channels-updated', importedChannels);
    } catch (error) {
      console.error('Error loading last channels:', error);
    }
  }

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    let channels;
    try {
      channels = require(channelsFilePath);
    } catch (error) {
      console.error('Error loading channels.js:', error);
      channels = [];
    }

    const channel = channels.find((ch) => details.url.includes(ch.file));
    if (channel?.httpOptions?.referrer) {
      details.requestHeaders['Referer'] = channel.httpOptions.referrer;
    } else {
      details.requestHeaders['Referer'] = "https://doolive4k.tv";
    }

    if (channel?.httpOptions?.userAgent) {
      details.requestHeaders['User-Agent'] = channel.httpOptions.userAgent;
    } else {
      details.requestHeaders['User-Agent'] =
        "Mozilla/5.0 (Linux; Android 7.1.2; TV BOX Build/NHG47L) AppleWebKit/537.36";
    }

    callback({ requestHeaders: details.requestHeaders });
  });

  // ตั้งค่าเมนูใน createWindow
  const menuTemplate = createMenuTemplate(currentLanguage);
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  console.log('Menu set in createWindow with language:', currentLanguage);
}

// เพิ่มการรองรับ .w3u
function parseW3U(content) {
  try {
    const w3uData = JSON.parse(content);
    const channels = [];
    const isStreamUrl = (url) => /\.(m3u8|mpd|mp4|ts)$/.test(url.toLowerCase());

    if (w3uData.groups) {
      w3uData.groups.forEach(group => {
        group.stations.forEach(station => {
          channels.push({
            name: station.name || "Unknown Channel",
            group: group.name || "กลุ่มที่ไม่ระบุ",
            logo: station.image || "",
            file: station.url || "",
            embed: station.embed || (!isStreamUrl(station.url) && station.url.startsWith('http')),
            isHost: station.isHost || false,
            httpOptions: {
              referrer: station.referer || "",
              userAgent: station.userAgent || ""
            }
          });
        });
      });
    }

    if (w3uData.stations) {
      w3uData.stations.forEach(station => {
        channels.push({
          name: station.name || "Unknown Channel",
          group: "กลุ่มที่ไม่ระบุ",
          logo: station.image || "",
          file: station.url || "",
          embed: station.embed || (!isStreamUrl(station.url) && station.url.startsWith('http')),
          isHost: station.isHost || false,
          httpOptions: {
            referrer: station.referer || "",
            userAgent: station.userAgent || ""
          }
        });
      });
    }

    return channels;
  } catch (error) {
    console.error('Error parsing .w3u content:', error);
    throw error;
  }
}

async function importChannelsFromJsFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'JavaScript Files', extensions: ['js'] }],
  });

  if (!result.canceled) {
    try {
      const importedChannels = require(result.filePaths[0]);
      fs.writeFileSync(channelsFilePath, `module.exports = ${JSON.stringify(importedChannels, null, 2)};`);
      mainWindow.webContents.send('channels-updated', importedChannels);
      store.set('lastChannelsPath', result.filePaths[0]);
      return importedChannels;
    } catch (error) {
      console.error('Error importing .js file:', error);
      dialog.showErrorBox('Error', 'Failed to import .js file: ' + error.message);
    }
  }
  return null;
}

async function importChannelsFromM3U() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'M3U Files', extensions: ['m3u'] }],
  });

  if (!result.canceled) {
    try {
      const m3uContent = fs.readFileSync(result.filePaths[0], 'utf-8');
      const channels = parseM3U(m3uContent);
      fs.writeFileSync(channelsFilePath, `module.exports = ${JSON.stringify(channels, null, 2)};`);
      mainWindow.webContents.send('channels-updated', channels);
      store.set('lastChannelsPath', result.filePaths[0]);
      return channels;
    } catch (error) {
      console.error('Error importing .m3u file:', error);
      dialog.showErrorBox('Error', 'Failed to import .m3u file: ' + error.message);
    }
  }
  return null;
}

async function importChannelsFromM3UUrl() {
  const url = await prompt({
    title: currentLanguage === 'th' ? 'นำเข้าช่องจาก URL .m3u' : 'Import Channels from .m3u URL',
    label: 'Ctrl+V paste the .m3u URL:',
    inputAttrs: { type: 'url' },
    type: 'input',
  });

  if (url) {
    try {
      const response = await axios.get(url, { responseType: 'text' });
      const m3uContent = response.data;
      const channels = parseM3U(m3uContent);
      fs.writeFileSync(channelsFilePath, `module.exports = ${JSON.stringify(channels, null, 2)};`);
      mainWindow.webContents.send('channels-updated', channels);
      store.set('lastChannelsPath', channelsFilePath);
      return channels;
    } catch (error) {
      console.error('Error importing from .m3u URL:', error);
      dialog.showErrorBox('Error', 'Failed to import .m3u from URL: ' + error.message);
    }
  }
  return null;
}

async function importChannelsFromUrl() {
  const url = await prompt({
    title: currentLanguage === 'th' ? 'นำเข้าช่องจาก URL' : 'Import Channels from URL',
    label: 'Ctrl+V paste the URL:',
    inputAttrs: { type: 'url' },
    type: 'input',
  });

  if (url) {
    try {
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      fs.writeFileSync(channelsFilePath, response.data);
      const importedChannels = require(channelsFilePath);
      mainWindow.webContents.send('channels-updated', importedChannels);
      store.set('lastChannelsPath', channelsFilePath);
      return importedChannels;
    } catch (error) {
      console.error('Error importing from URL:', error);
      dialog.showErrorBox('Error', 'Failed to import from URL: ' + error.message);
    }
  }
  return null;
}

function parseM3U(content) {
  const lines = content.split('\n');
  const channels = [];
  let currentChannel = null;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('#EXTINF')) {
      const match = trimmedLine.match(/#EXTINF:-?\d+(?: (.+?))?,\s*(.+)$/);
      if (match) {
        currentChannel = {
          name: match[2] || 'Unknown Channel',
          group: match[1]?.match(/group-title="([^"]+)"/)?.[1] || 'กลุ่มที่ไม่ระบุ',
          logo: match[1]?.match(/tvg-logo="([^"]+)"/)?.[1] || '',
          file: '',
          httpOptions: {},
        };
      }
    } else if (trimmedLine.startsWith('#KODIPROP:inputstream.adaptive.license_type=clearkey') && currentChannel) {
      currentChannel.drm = { clearkey: {} };
    } else if (trimmedLine.startsWith('#KODIPROP:inputstream.adaptive.license_key') && currentChannel) {
      const keyMatch = trimmedLine.match(/license_key=([^:]+):(.+)/);
      if (keyMatch) {
        currentChannel.drm.clearkey.keyId = keyMatch[1];
        currentChannel.drm.clearkey.key = keyMatch[2];
      }
    } else if (trimmedLine.startsWith('#EXTVLCOPT:http-user-agent=') && currentChannel) {
      currentChannel.httpOptions.userAgent = trimmedLine.replace('#EXTVLCOPT:http-user-agent=', '');
    } else if (trimmedLine.startsWith('#EXTVLCOPT:http-referrer=') && currentChannel) {
      currentChannel.httpOptions.referrer = trimmedLine.replace('#EXTVLCOPT:http-referrer=', '');
    } else if (trimmedLine && !trimmedLine.startsWith('#') && currentChannel) {
      currentChannel.file = trimmedLine;
      channels.push(currentChannel);
      currentChannel = null;
    }
  }

  return channels;
}

async function exportChannelsAsJs(channels) {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'channels.js',
    filters: [{ name: 'JavaScript Files', extensions: ['js'] }],
  });

  if (!result.canceled) {
    fs.writeFileSync(result.filePath, `module.exports = ${JSON.stringify(channels, null, 2)};`);
    store.set('lastChannelsPath', result.filePath);
    return true;
  }
  return false;
}

async function exportChannelsAsM3U(channels) {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'playlist.m3u',
    filters: [{ name: 'M3U Files', extensions: ['m3u'] }],
  });

  if (!result.canceled) {
    let m3uContent = '#EXTM3U\n';
    channels.forEach(channel => {
      let extinf = `#EXTINF:-1 tvg-logo="${channel.logo || ''}" group-title="${channel.group || 'กลุ่มที่ไม่ระบุ'}"`;
      if (channel.drm?.clearkey) {
        extinf += `,${channel.name || 'Unknown Channel'}\n`;
        m3uContent += extinf;
        m3uContent += `#KODIPROP:inputstream.adaptive.license_type=clearkey\n`;
        m3uContent += `#KODIPROP:inputstream.adaptive.license_key=${channel.drm.clearkey.keyId}:${channel.drm.clearkey.key}\n`;
      } else {
        extinf += `,${channel.name || 'Unknown Channel'}\n`;
        m3uContent += extinf;
      }
      if (channel.httpOptions?.userAgent) {
        m3uContent += `#EXTVLCOPT:http-user-agent=${channel.httpOptions.userAgent}\n`;
      }
      if (channel.httpOptions?.referrer) {
        m3uContent += `#EXTVLCOPT:http-referrer=${channel.httpOptions.referrer}\n`;
      }
      m3uContent += `${channel.file}\n`;
    });
    fs.writeFileSync(result.filePath, m3uContent);
    return true;
  }
  return false;
}

async function checkForUpdatesManual() {
  try {
    const response = await axios.get(UPDATE_CHECK_URL);
    const latestVersion = response.data.version;
    const downloadUrl = response.data.downloadUrl;
    const notes = response.data.notes || '';

    if (compareVersions(latestVersion, CURRENT_VERSION) > 0) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: currentLanguage === 'th' ? 'มีการอัปเดตใหม่' : 'Update Available',
        message: currentLanguage === 'th'
          ? `มีเวอร์ชันใหม่ (${latestVersion}) พร้อมใช้งาน\nบันทึกการเปลี่ยนแปลง: ${notes}\nต้องการดาวน์โหลดหรือไม่?`
          : `A new version (${latestVersion}) is available.\nRelease Notes: ${notes}\nWould you like to download it?`,
        buttons: [currentLanguage === 'th' ? 'ดาวน์โหลด' : 'Download', currentLanguage === 'th' ? 'ยกเลิก' : 'Cancel'],
      }).then((response) => {
        if (response.response === 0) {
          shell.openExternal(downloadUrl);
        }
      });
    } else {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: currentLanguage === 'th' ? 'ไม่มีอัปเดต' : 'No Update Available',
        message: currentLanguage === 'th'
          ? 'คุณใช้เวอร์ชันล่าสุดอยู่แล้ว (' + CURRENT_VERSION + ')'
          : 'You are already using the latest version (' + CURRENT_VERSION + ')',
        buttons: [currentLanguage === 'th' ? 'ตกลง' : 'OK'],
      });
    }
  } catch (error) {
    dialog.showErrorBox(
      currentLanguage === 'th' ? 'ข้อผิดพลาด' : 'Error',
      currentLanguage === 'th'
        ? 'ไม่สามารถตรวจสอบการอัปเดตได้: ' + error.message
        : 'Could not check for updates: ' + error.message
    );
  }
}

function compareVersions(v1, v2) {
  const v1parts = v1.split('.').map(Number);
  const v2parts = v2.split('.').map(Number);
  for (let i = 0; i < v1parts.length; ++i) {
    if (v2parts.length === i) return 1;
    if (v1parts[i] === v2parts[i]) continue;
    if (v1parts[i] > v2parts[i]) return 1;
    return -1;
  }
  if (v1parts.length !== v2parts.length) return -1;
  return 0;
}

ipcMain.handle('get-favorites', async () => {
  return store.get('favorites', []);
});

ipcMain.on('set-favorites', (event, favorites) => {
  store.set('favorites', favorites);
});

ipcMain.handle('get-channels', async () => {
  try {
    return require(channelsFilePath);
  } catch (error) {
    console.error('Error loading channels.js:', error);
    return [];
  }
});

app.whenReady().then(() => {
  console.log('App is ready');
  createWindow();
  // บังคับตั้งค่าเมนูหลังจากสร้างหน้าต่าง
  const menuTemplate = createMenuTemplate(currentLanguage);
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  console.log('Menu set after app ready with language:', currentLanguage);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
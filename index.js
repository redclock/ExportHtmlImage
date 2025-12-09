const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Configuration switches for debugging
// Set these variables to true/false to enable/disable features
// ============================================================================

// Network interception
const INTERCEPT_REQUEST = true;
const INTERCEPT_RESPONSE = true;

// API interception
const INTERCEPT_FETCH = true;
const INTERCEPT_XHR = true;

// WebAudio interception
const INTERCEPT_AUDIO_CONTEXT = true;
const INTERCEPT_DECODE_AUDIO_DATA = true;
const INTERCEPT_CREATE_BUFFER = true;
const INTERCEPT_CREATE_BUFFER_SOURCE = true;
const INTERCEPT_CREATE_SCRIPT_PROCESSOR = true;
const INTERCEPT_OFFLINE_AUDIO_CONTEXT = true;

// DOM monitoring
const USE_MUTATION_OBSERVER = true;

// Periodic scanning
const ENABLE_PERIODIC_SCAN = true;

// Configuration object (for easier access)
const config = {
  interceptRequest: INTERCEPT_REQUEST,
  interceptResponse: INTERCEPT_RESPONSE,
  interceptFetch: INTERCEPT_FETCH,
  interceptXHR: INTERCEPT_XHR,
  interceptAudioContext: INTERCEPT_AUDIO_CONTEXT,
  interceptDecodeAudioData: INTERCEPT_DECODE_AUDIO_DATA,
  interceptCreateBuffer: INTERCEPT_CREATE_BUFFER,
  interceptCreateBufferSource: INTERCEPT_CREATE_BUFFER_SOURCE,
  interceptCreateScriptProcessor: INTERCEPT_CREATE_SCRIPT_PROCESSOR,
  interceptOfflineAudioContext: INTERCEPT_OFFLINE_AUDIO_CONTEXT,
  useMutationObserver: USE_MUTATION_OBSERVER,
  enablePeriodicScan: ENABLE_PERIODIC_SCAN,
};

// Check if any feature is enabled
const hasAnyFeatureEnabled = Object.values(config).some(v => v === true);

// Create output directory
const outputDir = path.join(__dirname, 'exported_files');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// MIME type to file extension mapping
const mimeToExtension = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'font/woff': 'woff',
  'font/woff2': 'woff2',
  'application/font-woff': 'woff',
  'application/font-woff2': 'woff2',
  'application/x-font-woff': 'woff',
  'application/x-font-woff2': 'woff2',
  'font/ttf': 'ttf',
  'application/x-font-ttf': 'ttf',
  'font/otf': 'otf',
  'application/x-font-opentype': 'otf',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
  'text/css': 'css',
  'application/javascript': 'js',
  'text/javascript': 'js',
};

// Parse data URI
function parseDataURI(dataURI) {
  const regex = /^data:([^;]+);base64,(.+)$/;
  const match = dataURI.match(regex);
  
  if (!match) {
    return null;
  }
  
  const mimeType = match[1];
  const base64Data = match[2];
  
  return {
    mimeType,
    base64Data
  };
}

// Get file extension from MIME type
function getExtensionFromMime(mimeType) {
  return mimeToExtension[mimeType.toLowerCase()] || 'bin';
}

// Saved data URIs for deduplication
const savedDataURIs = new Set();
// Saved audio buffers for deduplication
const savedAudioBuffers = new Set();

// Convert audio data to WAV format
// audioData: { sampleRate, length, numberOfChannels, channels: [Float32Array, ...] }
function audioBufferToWAV(audioData) {
  const numChannels = audioData.numberOfChannels;
  const sampleRate = audioData.sampleRate;
  const length = audioData.length;
  const channels = audioData.channels;
  
  // Create Buffer
  const buffer = Buffer.alloc(44 + length * numChannels * 2);
  
  // WAV file header
  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      buffer.writeUInt8(string.charCodeAt(i), offset + i);
    }
  };
  
  // RIFF header
  writeString(0, 'RIFF');
  buffer.writeUInt32LE(36 + length * numChannels * 2, 4);
  writeString(8, 'WAVE');
  
  // fmt chunk
  writeString(12, 'fmt ');
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // audio format (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * 2, 28); // byte rate
  buffer.writeUInt16LE(numChannels * 2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  
  // data chunk
  writeString(36, 'data');
  buffer.writeUInt32LE(length * numChannels * 2, 40);
  
  // Write audio data
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel][i]));
      const int16Sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      buffer.writeInt16LE(int16Sample, offset);
      offset += 2;
    }
  }
  
  return buffer;
}

// Save file
function saveFile(data, mimeType, index, dataURI = null) {
  // Check if dataURI has been saved before
  if (dataURI && savedDataURIs.has(dataURI)) {
    return null;
  }
  
  if (dataURI) {
    savedDataURIs.add(dataURI);
  }
  
  const extension = getExtensionFromMime(mimeType);
  const filename = `file_${index}_${Date.now()}.${extension}`;
  const filepath = path.join(outputDir, filename);
  
  fs.writeFileSync(filepath, data);
  console.log(`✓ Saved: ${filename} (${mimeType})`);
  return filepath;
}

// Save audio buffer
function saveAudioBuffer(audioBufferData, index) {
  // Create unique identifier (use hash of first 1000 samples to avoid identical audio)
  const sampleHash = audioBufferData.channels && audioBufferData.channels[0] 
    ? Array.from(audioBufferData.channels[0].slice(0, Math.min(1000, audioBufferData.length))).join(',')
    : '';
  const bufferId = `${audioBufferData.sampleRate}_${audioBufferData.length}_${audioBufferData.numberOfChannels}_${sampleHash.substring(0, 100)}`;
  
  if (savedAudioBuffers.has(bufferId)) {
    return null;
  }
  
  savedAudioBuffers.add(bufferId);
  
  try {
    // Validate data format
    if (!audioBufferData.channels || !Array.isArray(audioBufferData.channels)) {
      console.error('✗ Audio data format error: missing channels array');
      return null;
    }
    
    if (audioBufferData.channels.length !== audioBufferData.numberOfChannels) {
      console.error(`✗ Audio data format error: channel count mismatch (${audioBufferData.channels.length} vs ${audioBufferData.numberOfChannels})`);
      return null;
    }
    
    // Convert to WAV format
    const wavBuffer = audioBufferToWAV(audioBufferData);
    const filename = `audio_${index}_${Date.now()}.wav`;
    const filepath = path.join(outputDir, filename);
    
    fs.writeFileSync(filepath, wavBuffer);
    const duration = (audioBufferData.length / audioBufferData.sampleRate).toFixed(2);
    console.log(`✓ Saved audio: ${filename} (${audioBufferData.sampleRate}Hz, ${audioBufferData.numberOfChannels}ch, ${duration}s)`);
    return filepath;
  } catch (error) {
    console.error(`✗ Failed to save audio: ${error.message}`);
    console.error(error.stack);
    return null;
  }
}

// Extract data URI from URL
function extractDataURI(url) {
  if (url.startsWith('data:')) {
    return url;
  }
  return null;
}

// Convert local file path to file:// URL
function normalizeURL(input) {
  if (!input) {
    return 'https://www.example.com';
  }
  
  // If already a complete URL (http://, https://, file://), return directly
  if (input.startsWith('http://') || input.startsWith('https://') || input.startsWith('file://')) {
    return input;
  }
  
  // Handle local file path
  let filePath = input;
  
  // If relative path, convert to absolute path
  if (!path.isAbsolute(filePath)) {
    filePath = path.join(process.cwd(), filePath);
  }
  
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    console.warn(`Warning: File does not exist: ${filePath}`);
    console.warn(`Trying to access with relative path...`);
  }
  
  // Convert to file:// URL
  // Windows paths need special handling
  if (process.platform === 'win32') {
    filePath = filePath.replace(/\\/g, '/');
    if (!filePath.startsWith('/')) {
      filePath = '/' + filePath;
    }
    return `file://${filePath}`;
  } else {
    return `file://${filePath}`;
  }
}

async function main() {
  const input = process.argv[2] || 'document2.html';
  const url = normalizeURL(input);
  
  console.log(`Input path: ${input}`);
  console.log(`Accessing URL: ${url}`);
  console.log(`Files will be saved to: ${outputDir}\n`);
  
  // Display configuration
  console.log('Configuration:');
  console.log('  Network:');
  console.log(`    - Request interception: ${config.interceptRequest ? '✓' : '✗'}`);
  console.log(`    - Response interception: ${config.interceptResponse ? '✓' : '✗'}`);
  console.log('  API Interception:');
  console.log(`    - Fetch: ${config.interceptFetch ? '✓' : '✗'}`);
  console.log(`    - XMLHttpRequest: ${config.interceptXHR ? '✓' : '✗'}`);
  console.log('  WebAudio:');
  console.log(`    - AudioContext: ${config.interceptAudioContext ? '✓' : '✗'}`);
  console.log(`    - decodeAudioData: ${config.interceptDecodeAudioData ? '✓' : '✗'}`);
  console.log(`    - createBuffer: ${config.interceptCreateBuffer ? '✓' : '✗'}`);
  console.log(`    - createBufferSource: ${config.interceptCreateBufferSource ? '✓' : '✗'}`);
  console.log(`    - createScriptProcessor: ${config.interceptCreateScriptProcessor ? '✓' : '✗'}`);
  console.log(`    - OfflineAudioContext: ${config.interceptOfflineAudioContext ? '✓' : '✗'}`);
  console.log('  DOM Monitoring:');
  console.log(`    - MutationObserver: ${config.useMutationObserver ? '✓' : '✗'}`);
  console.log('  Scanning:');
  console.log(`    - Periodic scan: ${config.enablePeriodicScan ? '✓' : '✗'}`);
  console.log('');
  
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process']
  });
  
  const page = await browser.newPage();
  let fileIndex = 0;
  
  // Common function to process data URI
  async function processDataURI(dataURI) {
    const parsed = parseDataURI(dataURI);
    if (parsed) {
      try {
        const buffer = Buffer.from(parsed.base64Data, 'base64');
        const result = saveFile(buffer, parsed.mimeType, ++fileIndex, dataURI);
        return result !== null; // Return whether save was successful (may be null after deduplication)
      } catch (error) {
        console.error(`✗ Failed to parse data URI: ${error.message}`);
        return false;
      }
    }
    return false;
  }
  
  // Listen to network requests
  if (config.interceptRequest) {
    page.on('request', async (request) => {
      const url = request.url();
      const dataURI = extractDataURI(url);
      if (dataURI) {
        await processDataURI(dataURI);
      }
    });
  }
  
  // Listen to data URI in responses
  if (config.interceptResponse) {
    page.on('response', async (response) => {
      const url = response.url();
      const dataURI = extractDataURI(url);
      if (dataURI) {
        await processDataURI(dataURI);
      }
    });
  }
  
  // Execute page script to find all data URIs and monitor DOM changes and WebAudio
  // Only inject script if at least one feature is enabled
  if (hasAnyFeatureEnabled) {
    await page.evaluateOnNewDocument((config) => {
      try {
        // Store configuration
        window.__exporterConfig = config;
        
        // Store detected data URIs
        window.__detectedDataURIs = new Set();
        // Store detected audio buffers
        window.__detectedAudioBuffers = new Set();
      
      // Function to detect data URI
      function detectDataURI(url) {
        try {
          if (typeof url === 'string' && url.startsWith('data:')) {
            if (!window.__detectedDataURIs.has(url)) {
              window.__detectedDataURIs.add(url);
              window.__onDataURIDetected?.(url);
            }
          }
        } catch (e) {
          console.error('[DataURI Exporter] detectDataURI error:', e);
        }
      }
    
    // Function to detect audio buffer
    function detectAudioBuffer(audioBuffer) {
      if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') {
        return;
      }
      
      try {
        const bufferId = `${audioBuffer.sampleRate}_${audioBuffer.length}_${audioBuffer.numberOfChannels}`;
        
        if (!window.__detectedAudioBuffers.has(bufferId)) {
          window.__detectedAudioBuffers.add(bufferId);
          
          // Extract audio data
          const channels = [];
          for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
            channels.push(Array.from(audioBuffer.getChannelData(i)));
          }
          
          // Send to Node.js side for processing
          window.__onAudioBufferDetected?.({
            sampleRate: audioBuffer.sampleRate,
            length: audioBuffer.length,
            numberOfChannels: audioBuffer.numberOfChannels,
            channels: channels
          });
        }
      } catch (error) {
        console.error('Failed to detect audio buffer:', error);
      }
    }
    
    // Intercept AudioContext methods (needs to be defined externally for reuse)
    function interceptAudioContext(context) {
        try {
          if (!context) return;
          
          // Intercept decodeAudioData
          if (window.__exporterConfig.interceptDecodeAudioData && context.decodeAudioData && typeof context.decodeAudioData === 'function') {
            try {
              const originalDecodeAudioData = context.decodeAudioData.bind(context);
              context.decodeAudioData = function(arrayBuffer) {
                return originalDecodeAudioData(arrayBuffer).then((audioBuffer) => {
                  try {
                    detectAudioBuffer(audioBuffer);
                  } catch (e) {
                    console.error('[DataURI Exporter] detectAudioBuffer in decodeAudioData error:', e);
                  }
                  return audioBuffer;
                }).catch((error) => {
                  return Promise.reject(error);
                });
              };
            } catch (e) {
              console.error('[DataURI Exporter] Failed to intercept decodeAudioData:', e);
            }
          }
          
          // Intercept createBuffer
          if (window.__exporterConfig.interceptCreateBuffer && context.createBuffer && typeof context.createBuffer === 'function') {
            try {
              const originalCreateBuffer = context.createBuffer.bind(context);
              context.createBuffer = function(...args) {
                const buffer = originalCreateBuffer(...args);
                try {
                  detectAudioBuffer(buffer);
                } catch (e) {
                  console.error('[DataURI Exporter] detectAudioBuffer in createBuffer error:', e);
                }
                return buffer;
              };
            } catch (e) {
              console.error('[DataURI Exporter] Failed to intercept createBuffer:', e);
            }
          }
          
          // Intercept createBufferSource
          if (window.__exporterConfig.interceptCreateBufferSource && context.createBufferSource && typeof context.createBufferSource === 'function') {
            try {
              const originalCreateBufferSource = context.createBufferSource.bind(context);
              context.createBufferSource = function() {
                const source = originalCreateBufferSource();
                
                try {
                  // Monitor buffer property setting
                  let bufferValue = null;
                  Object.defineProperty(source, 'buffer', {
                    get: function() {
                      return bufferValue;
                    },
                    set: function(value) {
                      bufferValue = value;
                      try {
                        if (value) {
                          detectAudioBuffer(value);
                        }
                      } catch (e) {
                        console.error('[DataURI Exporter] detectAudioBuffer in buffer setter error:', e);
                      }
                    },
                    configurable: true,
                    enumerable: true
                  });
                  
                  // Intercept start method
                  if (source.start && typeof source.start === 'function') {
                    const originalStart = source.start.bind(source);
                    source.start = function(...args) {
                      try {
                        if (bufferValue) {
                          detectAudioBuffer(bufferValue);
                        }
                      } catch (e) {
                        console.error('[DataURI Exporter] detectAudioBuffer in start error:', e);
                      }
                      return originalStart(...args);
                    };
                  }
                } catch (e) {
                  console.error('[DataURI Exporter] Failed to intercept createBufferSource property:', e);
                }
                
                return source;
              };
            } catch (e) {
              console.error('[DataURI Exporter] Failed to intercept createBufferSource:', e);
            }
          }
          
          // Monitor createScriptProcessor (deprecated but may still be used)
          if (window.__exporterConfig.interceptCreateScriptProcessor && context.createScriptProcessor && typeof context.createScriptProcessor === 'function') {
            try {
              const originalCreateScriptProcessor = context.createScriptProcessor.bind(context);
              context.createScriptProcessor = function(...args) {
                const processor = originalCreateScriptProcessor(...args);
                
                try {
                  // Monitor onaudioprocess event
                  const originalOnaudioprocess = processor.onaudioprocess;
                  processor.onaudioprocess = function(event) {
                    try {
                      if (event && event.inputBuffer) {
                        detectAudioBuffer(event.inputBuffer);
                      }
                    } catch (e) {
                      console.error('[DataURI Exporter] detectAudioBuffer in onaudioprocess error:', e);
                    }
                    if (originalOnaudioprocess) {
                      originalOnaudioprocess.call(this, event);
                    }
                  };
                } catch (e) {
                  console.error('[DataURI Exporter] Failed to intercept onaudioprocess:', e);
                }
                
                return processor;
              };
            } catch (e) {
              console.error('[DataURI Exporter] Failed to intercept createScriptProcessor:', e);
            }
          }
        } catch (e) {
          console.error('[DataURI Exporter] interceptAudioContext error:', e);
        }
    }
    
    // Intercept WebAudio API
    try {
      if (window.__exporterConfig.interceptAudioContext && (window.AudioContext || window.webkitAudioContext)) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const OriginalAudioContext = AudioContextClass;
        
        // Override AudioContext constructor
        window.AudioContext = function(...args) {
          try {
            const context = new OriginalAudioContext(...args);
            interceptAudioContext(context);
            return context;
          } catch (e) {
            console.error('[DataURI Exporter] AudioContext constructor interception failed:', e);
            // If interception fails, return original context
            return new OriginalAudioContext(...args);
          }
        };
        
        // Copy prototype and static properties
        try {
          Object.setPrototypeOf(window.AudioContext, OriginalAudioContext);
          Object.setPrototypeOf(window.AudioContext.prototype, OriginalAudioContext.prototype);
          Object.keys(OriginalAudioContext).forEach(key => {
            if (!(key in window.AudioContext)) {
              window.AudioContext[key] = OriginalAudioContext[key];
            }
          });
        } catch (e) {
          console.error('[DataURI Exporter] Failed to copy AudioContext prototype:', e);
        }
        
        window.webkitAudioContext = window.AudioContext;
        
        // Intercept OfflineAudioContext
        if (window.__exporterConfig.interceptOfflineAudioContext && (window.OfflineAudioContext || window.webkitOfflineAudioContext)) {
          const OfflineAudioContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
          const OriginalOfflineAudioContext = OfflineAudioContextClass;
          
          window.OfflineAudioContext = function(...args) {
            try {
              const context = new OriginalOfflineAudioContext(...args);
              interceptAudioContext(context);
              
              // Intercept startRendering
              if (context.startRendering && typeof context.startRendering === 'function') {
                try {
                  const originalStartRendering = context.startRendering.bind(context);
                  context.startRendering = function() {
                    return originalStartRendering().then((audioBuffer) => {
                      try {
                        detectAudioBuffer(audioBuffer);
                      } catch (e) {
                        console.error('[DataURI Exporter] detectAudioBuffer in startRendering error:', e);
                      }
                      return audioBuffer;
                    });
                  };
                } catch (e) {
                  console.error('[DataURI Exporter] Failed to intercept startRendering:', e);
                }
              }
              
              return context;
            } catch (e) {
              console.error('[DataURI Exporter] OfflineAudioContext constructor interception failed:', e);
              // If interception fails, return original context
              return new OriginalOfflineAudioContext(...args);
            }
          };
          
          // Copy prototype and static properties
          try {
            Object.setPrototypeOf(window.OfflineAudioContext, OriginalOfflineAudioContext);
            Object.setPrototypeOf(window.OfflineAudioContext.prototype, OriginalOfflineAudioContext.prototype);
            Object.keys(OriginalOfflineAudioContext).forEach(key => {
              if (!(key in window.OfflineAudioContext)) {
                window.OfflineAudioContext[key] = OriginalOfflineAudioContext[key];
              }
            });
          } catch (e) {
            console.error('[DataURI Exporter] Failed to copy OfflineAudioContext prototype:', e);
          }
          
          window.webkitOfflineAudioContext = window.OfflineAudioContext;
        }
      }
    } catch (e) {
      console.error('[DataURI Exporter] WebAudio API interception failed:', e);
    }
    
    // After page loads, try to intercept existing AudioContext
    function interceptExistingContexts() {
      try {
        // Find all possible AudioContext instances
        if (window.AudioContext || window.webkitAudioContext) {
          // Try to find AudioContext instances from global variables
          for (const key in window) {
            try {
              const value = window[key];
              if (value && typeof value === 'object') {
                // Check if it's an AudioContext instance
                if (value.constructor && (
                  value.constructor.name === 'AudioContext' ||
                  value.constructor.name === 'webkitAudioContext'
                )) {
                  interceptAudioContext(value);
                }
              }
            } catch (e) {
              console.error('[DataURI Exporter] Failed to access window property:', key, e);
            }
          }
        }
      } catch (e) {
        console.error('[DataURI Exporter] interceptExistingContexts error:', e);
      }
    }
    
    // Try to intercept after DOM loads
    try {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', interceptExistingContexts);
      } else {
        interceptExistingContexts();
      }
      
      // Delay execution to ensure page scripts have run
      setTimeout(interceptExistingContexts, 1000);
    } catch (e) {
      console.error('[DataURI Exporter] Failed to setup interceptExistingContexts:', e);
    }
    
    // Intercept fetch
    try {
      if (window.__exporterConfig.interceptFetch && window.fetch && typeof window.fetch === 'function') {
        const originalFetch = window.fetch;
        window.fetch = function(...args) {
          try {
            const url = args[0];
            detectDataURI(url);
          } catch (e) {
            console.error('[DataURI Exporter] detectDataURI in fetch error:', e);
          }
          return originalFetch.apply(this, args);
        };
      }
    } catch (e) {
      console.error('[DataURI Exporter] Failed to intercept fetch:', e);
    }
    
    // Intercept XMLHttpRequest
    try {
      if (window.__exporterConfig.interceptXHR && XMLHttpRequest && XMLHttpRequest.prototype && XMLHttpRequest.prototype.open) {
        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          try {
            detectDataURI(url);
          } catch (e) {
            console.error('[DataURI Exporter] detectDataURI in XMLHttpRequest error:', e);
          }
          return originalOpen.apply(this, [method, url, ...rest]);
        };
      }
    } catch (e) {
      console.error('[DataURI Exporter] Failed to intercept XMLHttpRequest:', e);
    }
    
    // Use MutationObserver to monitor DOM changes
    let observer = null;
    try {
      if (window.__exporterConfig.useMutationObserver) {
        observer = new MutationObserver((mutations) => {
        try {
          mutations.forEach((mutation) => {
            try {
              mutation.addedNodes.forEach((node) => {
                try {
                  if (node && node.nodeType === 1) { // Element node
                    // Check img src
                    if (node.tagName === 'IMG' && node.src && typeof node.src === 'string' && node.src.startsWith('data:')) {
                      detectDataURI(node.src);
                    }
                    // Check style attribute
                    if (node.style && node.style.backgroundImage) {
                      const bgMatch = node.style.backgroundImage.match(/url\(['"]?(data:[^'"]+)['"]?\)/);
                      if (bgMatch) detectDataURI(bgMatch[1]);
                    }
                    // Check inline style attribute
                    const inlineStyle = node.getAttribute('style');
                    if (inlineStyle) {
                      const styleMatch = inlineStyle.match(/url\(['"]?(data:[^'"]+)['"]?\)/);
                      if (styleMatch) detectDataURI(styleMatch[1]);
                    }
                    // Check child elements
                    if (node.querySelectorAll) {
                      try {
                        const dataURIElements = node.querySelectorAll('[src^="data:"], [href^="data:"], [style*="data:"]');
                        dataURIElements?.forEach((el) => {
                          try {
                            if (el.src) detectDataURI(el.src);
                            if (el.href) detectDataURI(el.href);
                            const style = el.getAttribute('style');
                            if (style) {
                              const match = style.match(/url\(['"]?(data:[^'"]+)['"]?\)/);
                              if (match) detectDataURI(match[1]);
                            }
                          } catch (e) {
                            console.error('[DataURI Exporter] Element processing error:', e);
                          }
                        });
                      } catch (e) {
                        console.error('[DataURI Exporter] querySelectorAll error:', e);
                      }
                    }
                  }
                } catch (e) {
                  console.error('[DataURI Exporter] Node processing error:', e);
                }
              });
            } catch (e) {
              console.error('[DataURI Exporter] Mutation processing error:', e);
            }
          });
        } catch (e) {
          console.error('[DataURI Exporter] Observer callback error:', e);
        }
      });
      }
    } catch (e) {
      console.error('[DataURI Exporter] Observer creation error:', e);
    }
    
    // Function to start observing
    function startObserving() {
      if (!observer) return;
      try {
        const targetNode = document.body || document.documentElement;
        if (targetNode && targetNode.nodeType === 1) {
          try {
            observer.observe(targetNode, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['src', 'href', 'style']
            });
          } catch (e) {
            console.error('[DataURI Exporter] Observer.observe error:', e);
          }
        }
      } catch (e) {
        console.error('[DataURI Exporter] startObserving error:', e);
      }
    }
    
    // Start observing when DOM is ready
    try {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserving);
      } else {
        // DOM already loaded
        startObserving();
      }
      
      // Also try after a short delay to ensure document.body exists
      setTimeout(startObserving, 100);
    } catch (e) {
      console.error('[DataURI Exporter] Observer setup error:', e);
    }
    } catch (e) {
      console.error('[DataURI Exporter] Script injection error:', e);
    }
    }, config);
  }
  
  // Set callback function to receive detected data URIs from page
  if (hasAnyFeatureEnabled) {
    await page.exposeFunction('__onDataURIDetected', async (dataURI) => {
      await processDataURI(dataURI);
    });
    
    // Set callback function to receive detected audio buffers from page
    await page.exposeFunction('__onAudioBufferDetected', async (audioBufferData) => {
      saveAudioBuffer(audioBufferData, ++fileIndex);
    });
  }
  
  // Function to scan all data URIs in the page
  async function scanPageForDataURIs() {
    const dataURIs = await page.evaluate(() => {
      const results = [];
      
      // Find all img tag src attributes
      document.querySelectorAll('img[src^="data:"]').forEach((img) => {
        results.push(img.src);
      });
      
      // Find all CSS background-image
      const styleSheets = Array.from(document.styleSheets);
      styleSheets.forEach((sheet) => {
        try {
          const rules = Array.from(sheet.cssRules || []);
          rules.forEach((rule) => {
            if (rule.style && rule.style.backgroundImage) {
              const bgImage = rule.style.backgroundImage;
              const dataURIMatch = bgImage.match(/url\(['"]?(data:[^'"]+)['"]?\)/);
              if (dataURIMatch) {
                results.push(dataURIMatch[1]);
              }
            }
          });
        } catch (e) {
          console.error('[DataURI Exporter] Cannot access stylesheet (cross-origin?):', e);
        }
      });
      
      // Find data URIs in inline styles
      document.querySelectorAll('[style*="data:"]').forEach((el) => {
        const style = el.getAttribute('style');
        const dataURIMatch = style.match(/url\(['"]?(data:[^'"]+)['"]?\)/);
        if (dataURIMatch) {
          results.push(dataURIMatch[1]);
        }
      });
      
      // Find all data URIs in <link> tags (fonts, etc.)
      document.querySelectorAll('link[href^="data:"]').forEach((link) => {
        results.push(link.href);
      });
      
      // Find all data URIs in <source> tags (audio/video)
      document.querySelectorAll('source[src^="data:"]').forEach((source) => {
        results.push(source.src);
      });
      
      // Find all data URIs in <audio> and <video> tags
      document.querySelectorAll('audio[src^="data:"], video[src^="data:"]').forEach((media) => {
        results.push(media.src);
      });
      
      // Note: Canvas scanning is disabled to avoid interfering with WebGL/WebGPU contexts
      // Calling getContext('2d') or toDataURL() on WebGL canvases can break the WebGL context
      // If you need to capture canvas images, use the network interception or API interception instead
      
      return results;
    });
    
    // Process found data URIs
    let newCount = 0;
    for (const dataURI of dataURIs) {
      try {
        const saved = await processDataURI(dataURI);
        if (saved) newCount++;
      } catch (e) {
        console.error('[DataURI Exporter] Error processing data URI:', e);
      }
    }
    
    return { total: dataURIs.length, new: newCount };
  }
  
  // After page loads, find all elements containing data URI
  if (hasAnyFeatureEnabled) {
    page.on('load', async () => {
      console.log('\nPage loaded, scanning for data URIs...\n');
      const result = await scanPageForDataURIs();
      console.log(`Scan complete: found ${result.total} data URIs, ${result.new} new\n`);
    });
  }
  
  // Periodically scan page (to capture dynamically loaded resources)
  let scanInterval = null;
  
  function startPeriodicScan(intervalMs = 3000) {
    if (!config.enablePeriodicScan) {
      return;
    }
    if (scanInterval) {
      clearInterval(scanInterval);
    }
    scanInterval = setInterval(async () => {
      try {
        const result = await scanPageForDataURIs();
        if (result.new > 0) {
          console.log(`[Periodic Scan] Found ${result.new} new data URIs`);
        }
      } catch (error) {
        console.error('[DataURI Exporter] Periodic scan error:', error);
      }
    }, intervalMs);
  }
  
  function stopPeriodicScan() {
    if (scanInterval) {
      clearInterval(scanInterval);
      scanInterval = null;
    }
  }
  
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  } catch (error) {
    console.error(`Failed to access page: ${error.message}`);
  }
  
  // Wait for user operations
  console.log('\n═══════════════════════════════════════════════════');
  console.log('Page loaded successfully!');
  console.log('You can now operate the page in the browser (click, scroll, input, etc.)');
  console.log('Script will continuously monitor and save all data URI resources');
  console.log('═══════════════════════════════════════════════════\n');
  
  // Start periodic scanning
  if (hasAnyFeatureEnabled) {
    startPeriodicScan(2000); // Scan every 2 seconds
  }
  
  // Provide interactive commands
  console.log('Available commands:');
  console.log('  - Press Enter: Scan page immediately');
  console.log('  - Type "scan": Scan page immediately');
  console.log('  - Type "stop": Stop periodic scanning');
  console.log('  - Type "start": Start periodic scanning');
  console.log('  - Type "status": View current status');
  console.log('  - Press Ctrl+C: Exit program\n');
  
  // Set up standard input listener
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  // Cleanup function
  let isExiting = false;
  async function cleanup() {
    if (isExiting) return;
    isExiting = true;
    
    stopPeriodicScan();
    rl.close();
    
    try {
      if (browser && browser.isConnected()) {
        await browser.close();
      }
    } catch (error) {
      console.error('[DataURI Exporter] Browser close error:', error);
    }
  }
  
  rl.on('line', async (input) => {
    // If browser is closed, don't process commands
    if (!browser.isConnected()) {
      return;
    }
    
    const command = input.trim().toLowerCase();
    
    switch (command) {
      case '':
      case 'scan':
        if (browser.isConnected()) {
          if (hasAnyFeatureEnabled) {
            console.log('\nScanning page...');
            try {
              const result = await scanPageForDataURIs();
              console.log(`Scan complete: ${result.total} data URIs total, ${result.new} new\n`);
            } catch (error) {
              console.error(`Scan failed: ${error.message}\n`);
            }
          } else {
            console.log('All features are disabled. Enable at least one feature to use scanning.\n');
          }
        } else {
          console.log('Browser is closed, cannot scan\n');
        }
        break;
        
      case 'stop':
        stopPeriodicScan();
        console.log('Periodic scanning stopped\n');
        break;
        
      case 'start':
        if (browser.isConnected()) {
          if (hasAnyFeatureEnabled) {
            startPeriodicScan(2000);
            console.log('Periodic scanning started (every 2 seconds)\n');
          } else {
            console.log('All features are disabled. Enable at least one feature to use scanning.\n');
          }
        } else {
          console.log('Browser is closed, cannot start scanning\n');
        }
        break;
        
      case 'status':
        console.log(`\nCurrent status:`);
        console.log(`  - Files saved: ${fileIndex}`);
        console.log(`  - Periodic scan: ${scanInterval ? 'Running' : 'Stopped'}`);
        console.log(`  - Browser status: ${browser.isConnected() ? 'Connected' : 'Disconnected'}`);
        console.log(`  - Output directory: ${outputDir}\n`);
        break;
        
      default:
        if (command) {
          console.log(`Unknown command: ${command}\n`);
        }
    }
  });
  
  // Listen to browser disconnection event
  browser.on('disconnected', () => {
    console.log('\n\nBrowser closed detected, exiting...');
    cleanup().then(() => {
      console.log('Script stopped');
      process.exit(0);
    }).catch((error) => {
      console.error(`Error during exit: ${error.message}`);
      process.exit(1);
    });
  });
  
  // Listen to page close event
  page.on('close', () => {
    if (browser.isConnected()) {
      console.log('\nPage closed');
    }
  });
  
  // Keep browser open
  process.on('SIGINT', async () => {
    console.log('\n\nReceived exit signal, closing...');
    await cleanup();
    process.exit(0);
  });
  
  // Handle other exit signals
  process.on('SIGTERM', async () => {
    console.log('\n\nReceived termination signal, closing...');
    await cleanup();
    process.exit(0);
  });
}

main().catch(console.error);


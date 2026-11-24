/* TokenWallet — add any ERC-20 token to a wallet in one click.
   Mechanism: EIP-747 wallet_watchAsset for injected wallets (MetaMask,
   Trust Wallet extension, TokenPocket, Coinbase Wallet, Exodus Web3),
   EIP-6963 provider discovery, EIP-3085 wallet_addEthereumChain for
   network switching, and eth_call reads of symbol()/decimals() so the
   token is added with the exact on-chain metadata. Nothing here ever
   asks for a seed phrase or private key, and no transaction is sent. */

'use strict';

const CHAINS = [
  { id: 1,     name: 'Ethereum',  symbol: 'ETH',   rpc: 'https://eth.llamarpc.com',        explorer: 'https://etherscan.io' },
  { id: 56,    name: 'BNB Chain', symbol: 'BNB',   rpc: 'https://bsc-dataseed.binance.org', explorer: 'https://bscscan.com' },
  { id: 137,   name: 'Polygon',   symbol: 'MATIC', rpc: 'https://polygon-rpc.com',          explorer: 'https://polygonscan.com' },
  { id: 42161, name: 'Arbitrum One', symbol: 'ETH', rpc: 'https://arb1.arbitrum.io/rpc',    explorer: 'https://arbiscan.io' },
  { id: 8453,  name: 'Base',      symbol: 'ETH',   rpc: 'https://mainnet.base.org',          explorer: 'https://basescan.org' },
  { id: 43114, name: 'Avalanche', symbol: 'AVAX',  rpc: 'https://api.avax.network/ext/bc/C/rpc', explorer: 'https://snowtrace.io' },
  { id: 11155111, name: 'Sepolia (testnet)', symbol: 'ETH', rpc: 'https://ethereum-sepolia-rpc.publicnode.com', explorer: 'https://sepolia.etherscan.io' },
];

const $ = (id) => document.getElementById(id);
const logEl = $('log');
const KNOWN_WALLETS = [
  { flag: 'isMetaMask',      name: 'MetaMask' },
  { flag: 'isTrust',         name: 'Trust Wallet' },
  { flag: 'isTokenPocket',   name: 'TokenPocket' },
  { flag: 'isCoinbaseWallet', name: 'Coinbase Wallet' },
  { flag: 'isExodus',        name: 'Exodus' },
  { flag: 'isBraveWallet',   name: 'Brave Wallet' },
  { flag: 'isRabby',         name: 'Rabby' },
  { flag: 'isPhantom',       name: 'Phantom' },
];

let provider = null;          // active EIP-1193 provider
let providers = [];           // all discovered providers [{info, provider}]
let account = null;
let chainId = null;

function log(msg) {
  const t = new Date().toLocaleTimeString();
  logEl.textContent += `[${t}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(el, msg, kind) {
  el.textContent = msg;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

/* ---------- provider discovery (EIP-6963 + legacy injection) ---------- */
function identify(providerObj) {
  const names = KNOWN_WALLETS.filter((w) => providerObj[w.flag]).map((w) => w.name);
  return names.length ? names.join(' / ') : 'Injected wallet';
}

function onProviderAnnounced(event) {
  const { info, provider: p } = event.detail;
  providers.push({ info, provider: p });
  renderDetected();
  log(`Detected wallet via EIP-6963: ${info.name}`);
}

function discoverProviders() {
  window.addEventListener('eip6963:announceProvider', onProviderAnnounced);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  if (window.ethereum) {
    // Legacy injection: single provider, or providers array (e.g. multiple wallets).
    const list = Array.isArray(window.ethereum.providers) ? window.ethereum.providers : [window.ethereum];
    for (const p of list) {
      if (!providers.some((x) => x.provider === p)) {
        providers.push({ info: { name: identify(p), rdns: '' }, provider: p });
      }
    }
  }
  renderDetected();
}

function renderDetected() {
  const box = $('detectedWallets');
  box.innerHTML = '';
  const all = KNOWN_WALLETS.map((w) => w.name);
  const found = new Set(providers.map((x) => x.info.name));
  for (const name of all) {
    const chip = document.createElement('span');
    chip.className = 'wallet-chip' + (found.has(name) ? ' detected' : '');
    chip.textContent = (found.has(name) ? '✓ ' : '') + name;
    box.appendChild(chip);
  }
  if (!providers.length) {
    const note = document.createElement('span');
    note.className = 'muted small';
    note.textContent = 'No injected wallet detected in this browser. Install MetaMask / Trust Wallet extension, or open this page inside a mobile wallet browser.';
    box.appendChild(note);
  }
}

/* ---------- connect / network ---------- */
async function connect() {
  if (!providers.length) {
    setStatus($('walletStatus'), 'No wallet detected. Install a wallet extension or open this page in a wallet app browser.', 'err');
    log('Connect failed: no provider found.');
    return;
  }
  // Prefer MetaMask if present, else the first discovered provider.
  const picked = providers.find((x) => /metamask/i.test(x.info.name)) || providers[0];
  provider = picked.provider;
  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    account = accounts[0];
    chainId = await provider.request({ method: 'eth_chainId' });
    $('connectBtn').disabled = true;
    $('disconnectBtn').disabled = false;
    $('chainRow').hidden = false;
    renderChainSelect();
    setStatus($('walletStatus'), `Connected: ${account} on ${chainName(parseInt(chainId, 16))} (via ${picked.info.name}).`, 'ok');
    log(`Connected ${account} on chain ${parseInt(chainId, 16)} via ${picked.info.name}.`);
    provider.on?.('accountsChanged', (accs) => {
      account = accs[0] || null;
      setStatus($('walletStatus'), account ? `Connected: ${account}` : 'Disconnected.', account ? 'ok' : '');
    });
    provider.on?.('chainChanged', (id) => {
      chainId = id;
      renderChainSelect();
      log(`Chain changed to ${parseInt(id, 16)} (${chainName(parseInt(id, 16))}).`);
    });
  } catch (err) {
    setStatus($('walletStatus'), `Connection rejected: ${err.message || err}`, 'err');
    log(`Connect rejected: ${err.message || err}`);
  }
}

function chainName(id) {
  const c = CHAINS.find((x) => x.id === id);
  return c ? c.name : `chain ${id}`;
}

function renderChainSelect() {
  const sel = $('chainSelect');
  sel.innerHTML = '';
  for (const c of CHAINS) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.name} (${c.id})`;
    if (chainId && parseInt(chainId, 16) === c.id) opt.selected = true;
    sel.appendChild(opt);
  }
}

async function switchChain() {
  if (!provider) return setStatus($('walletStatus'), 'Connect a wallet first.', 'err');
  const target = CHAINS.find((c) => c.id === Number($('chainSelect').value));
  const hexId = '0x' + target.id.toString(16);
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
    setStatus($('walletStatus'), `Switched to ${target.name}.`, 'ok');
    log(`Switched to ${target.name}.`);
  } catch (err) {
    if (err.code === 4902) {
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{ chainId: hexId, chainName: target.name, nativeCurrency: { name: target.symbol, symbol: target.symbol, decimals: 18 }, rpcUrls: [target.rpc], blockExplorerUrls: [target.explorer] }],
        });
        setStatus($('walletStatus'), `Added and switched to ${target.name}.`, 'ok');
        log(`Added chain ${target.name} and switched.`);
      } catch (e2) {
        setStatus($('walletStatus'), `Could not add network: ${e2.message || e2}`, 'err');
      }
    } else {
      setStatus($('walletStatus'), `Switch failed: ${err.message || err}`, 'err');
    }
  }
}

/* ---------- token metadata via eth_call ---------- */
function isAddress(v) { return /^0x[0-9a-fA-F]{40}$/.test(v); }

async function ethCall(to, data) {
  const res = await provider.request({
    method: 'eth_call',
    params: [{ to, data }, 'latest'],
  });
  return res;
}

function decodeString(hex) {
  // Minimal ABI string decode: offset(32) + length(32) + utf8 bytes.
  try {
    const bytes = hexToBytes(hex);
    const len = Number(BigInt('0x' + bytesToHex(bytes.slice(32, 64))));
    return new TextDecoder().decode(bytes.slice(64, 64 + len));
  } catch { return ''; }
}

function hexToBytes(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(bytes) { return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''); }

async function fetchMetadata() {
  const address = $('tokenAddress').value.trim();
  if (!provider) return setStatus($('tokenStatus'), 'Connect a wallet first — metadata is read from the chain through your wallet.', 'err');
  if (!isAddress(address)) return setStatus($('tokenStatus'), 'Enter a valid 0x contract address first.', 'err');
  setStatus($('tokenStatus'), 'Reading symbol() and decimals() from the chain…');
  try {
    const [symHex, decHex] = await Promise.all([
      ethCall(address, '0x95d89b41'), // symbol()
      ethCall(address, '0x313ce567'), // decimals()
    ]);
    const symbol = decodeString(symHex);
    const decimals = parseInt(decHex, 16);
    if (symbol) $('tokenSymbol').value = symbol;
    if (!Number.isNaN(decimals)) $('tokenDecimals').value = decimals;
    setStatus($('tokenStatus'), `On-chain metadata: symbol ${symbol || '(unreadable)'}, decimals ${decimals}. Check them, then press "Add token to wallet".`, 'ok');
    log(`Metadata for ${address}: symbol=${symbol}, decimals=${decimals}.`);
    updatePreview();
    updateCopyBox();
  } catch (err) {
    setStatus($('tokenStatus'), `Could not read metadata (is the address a token contract on the connected network?): ${err.message || err}`, 'err');
    log(`Metadata read failed: ${err.message || err}`);
  }
}

/* ---------- add token: EIP-747 wallet_watchAsset ---------- */
async function addToken() {
  const address = $('tokenAddress').value.trim();
  const symbol = $('tokenSymbol').value.trim();
  const decimals = Number($('tokenDecimals').value);
  const image = $('tokenImage').value.trim();
  if (!provider) return setStatus($('tokenStatus'), 'Connect a wallet first.', 'err');
  if (!isAddress(address)) return setStatus($('tokenStatus'), 'Enter a valid 0x contract address.', 'err');
  if (!symbol) return setStatus($('tokenStatus'), 'Enter the token symbol (or read it from the chain first).', 'err');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    return setStatus($('tokenStatus'), 'Decimals must be a whole number between 0 and 18.', 'err');
  }
  setStatus($('tokenStatus'), `Asking your wallet to watch ${symbol} (${address.slice(0, 10)}…)…`);
  try {
    const added = await provider.request({
      method: 'wallet_watchAsset',
      params: { type: 'ERC20', options: { address, symbol, decimals, image: image || undefined } },
    });
    if (added) {
      setStatus($('tokenStatus'), `${symbol} added to your wallet. Check your wallet's token list — the balance shown comes from the chain, not from this site.`, 'ok');
      log(`wallet_watchAsset accepted: ${symbol} ${address} (${decimals} decimals).`);
      saveHistory({ address, symbol, decimals, chain: chainId ? parseInt(chainId, 16) : null, at: new Date().toISOString() });
    } else {
      setStatus($('tokenStatus'), 'Your wallet declined the request. You can still add it manually — see section 3 below.', 'err');
      log('wallet_watchAsset declined by user/wallet.');
    }
  } catch (err) {
    setStatus($('tokenStatus'), `Your wallet does not support the automatic prompt (${err.message || err}). Use the manual steps in section 3 — they work with every wallet, including Ledger and Exodus.`, 'err');
    log(`wallet_watchAsset error: ${err.message || err}`);
  }
}

/* ---------- presets, history, misc UI ---------- */
async function loadPresets() {
  try {
    const res = await fetch('tokens.json');
    const tokens = await res.json();
    const box = $('presetList');
    for (const t of tokens) {
      const b = document.createElement('button');
      b.className = 'preset';
      b.textContent = `${t.symbol} · ${t.chain}`;
      b.title = t.address;
      b.addEventListener('click', () => {
        $('tokenAddress').value = t.address;
        $('tokenSymbol').value = t.symbol;
        $('tokenDecimals').value = t.decimals;
        $('tokenImage').value = t.image || '';
        const sel = $('chainSelect');
        const opt = [...sel.options].find((o) => Number(o.value) === t.chainId);
        if (opt) sel.value = String(t.chainId);
        updatePreview();
        updateCopyBox();
        setStatus($('tokenStatus'), `Preset loaded: ${t.symbol} on ${t.chain}. Press "Add token to wallet".`);
        log(`Preset selected: ${t.symbol} ${t.address}.`);
      });
      box.appendChild(b);
    }
  } catch (err) {
    log(`Could not load tokens.json presets: ${err.message || err}`);
  }
}

function updatePreview() {
  const sym = $('tokenSymbol').value.trim();
  const addr = $('tokenAddress').value.trim();
  const img = $('tokenImage').value.trim();
  $('tokenPreview').hidden = !(sym || addr);
  $('previewSymbol').textContent = sym || '(no symbol yet)';
  $('previewAddress').textContent = addr;
  $('previewImg').src = img || '';
  $('previewImg').style.display = img ? '' : 'none';
}

function updateCopyBox() {
  $('copyAddress').textContent = $('tokenAddress').value.trim() || '—';
  $('copySymbol').textContent = $('tokenSymbol').value.trim() || '—';
  $('copyDecimals').textContent = $('tokenDecimals').value.trim() || '—';
}

function saveHistory(entry) {
  const list = JSON.parse(localStorage.getItem('tw_history') || '[]');
  list.unshift(entry);
  localStorage.setItem('tw_history', JSON.stringify(list.slice(0, 20)));
  renderHistory();
}

function renderHistory() {
  const list = JSON.parse(localStorage.getItem('tw_history') || '[]');
  const ul = $('historyList');
  ul.innerHTML = '';
  if (!list.length) {
    ul.innerHTML = '<li class="muted">Nothing added yet in this browser.</li>';
    return;
  }
  for (const h of list) {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${escapeHtml(h.symbol)}</strong> <span class="mono">${escapeHtml(h.address)}</span> — ${h.decimals} decimals · chain ${h.chain ?? '?'} · ${new Date(h.at).toLocaleString()}`;
    ul.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    log(`Copied ${label} to clipboard.`);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    log(`Copied ${label} to clipboard (fallback).`);
  }
}

/* ---------- wire up ---------- */
$('connectBtn').addEventListener('click', connect);
$('disconnectBtn').addEventListener('click', () => {
  provider = null; account = null;
  $('connectBtn').disabled = false;
  $('disconnectBtn').disabled = true;
  $('chainRow').hidden = true;
  setStatus($('walletStatus'), 'Disconnected. (Your wallet app stays connected on its side — revoke from the wallet if needed.)');
  log('Disconnected in UI.');
});
$('switchChainBtn').addEventListener('click', switchChain);
$('fetchMetaBtn').addEventListener('click', fetchMetadata);
$('addTokenBtn').addEventListener('click', addToken);
$('clearHistoryBtn').addEventListener('click', () => { localStorage.removeItem('tw_history'); renderHistory(); });
$('copyUrlBtn').addEventListener('click', () => copyText(location.href, 'page link'));
for (const btn of document.querySelectorAll('[data-copy]')) {
  btn.addEventListener('click', () => {
    const target = $(btn.getAttribute('data-copy'));
    if (target.textContent && target.textContent !== '—') copyText(target.textContent, btn.getAttribute('data-copy'));
  });
}
for (const id of ['tokenAddress', 'tokenSymbol', 'tokenDecimals', 'tokenImage']) {
  $(id).addEventListener('input', () => { updatePreview(); updateCopyBox(); });
}

// Trust Wallet deep link: opens this page inside Trust Wallet's dApp browser.
$('trustOpenLink').href = 'https://link.trustwallet.com/open_url?coin_id=60&url=' + encodeURIComponent(location.href);

discoverProviders();
renderChainSelect();
loadPresets();
renderHistory();
updateCopyBox();
log('TokenWallet ready. No wallet connected yet.');

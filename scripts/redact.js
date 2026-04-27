#!/usr/bin/env node
/**
 * Mapick redaction engine — regex-only PII stripping (Node.js)
 * Usage: node redact.js "text with secrets"
 *        echo "text" | node redact.js
 *        node redact.js --no-code-aware  (strict mode, no code-block exemption)
 */

const fs = require('fs');

const RULES = [
  // Provider-specific API keys (must be BEFORE generic sk-*)
  [/\bsk-ant-[a-zA-Z0-9_-]{20,}/g, '[API_KEY_ANTHROPIC]'],
  [/\bsk_(test|live)_[a-zA-Z0-9]{24,}/g, '[API_KEY_STRIPE]'],
  [/\bglm-[a-zA-Z0-9_-]{20,}/g, '[API_KEY_GLM]'],
  [/\bghp_[a-zA-Z0-9]{36,}/g, '[TOKEN_GITHUB]'],
  [/\bgho_[a-zA-Z0-9]{36,}/g, '[TOKEN_GITHUB]'],
  [/\bghu_[a-zA-Z0-9]{36,}/g, '[TOKEN_GITHUB]'],
  [/\bghs_[a-zA-Z0-9]{36,}/g, '[TOKEN_GITHUB]'],
  [/\bAKIA[0-9A-Z]{16}/g, '[AWS_KEY]'],
  [/\bxox[bposr]-[a-zA-Z0-9-]{10,}/g, '[SLACK_TOKEN]'],
  [/\borg-[a-zA-Z0-9]{20,}/g, '[OPENAI_ORG]'],
  
  // Generic API keys (AFTER specific ones)
  [/\bsk-[a-zA-Z0-9]{20,}/g, '[API_KEY_OPENAI]'],
  
  // JWT
  [/\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, '[JWT]'],
  
  // PEM private keys
  [/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, '[PRIVATE_KEY]'],
  
  // SSH keys
  [/ssh-(rsa|ed25519|dss|ecdsa)\s+[A-Za-z0-9+/=]{100,}/g, '[SSH_KEY]'],
  
  // URL query tokens (BEFORE DB connection)
  [/[?&](token|key|secret|password|auth|api_key|apiKey)=([^\s&]+)/g, '$1=[REDACTED]'],
  
  // DB connection strings
  [/(postgres|postgresql|mysql|mongodb)(?:\+srv)?:\/\/[^\s]+/g, '[DB_CONNECTION]'],
  
  // Chinese national ID (18 digits, YYYYMMDD in middle, last char 0-9 or X)
  // BEFORE generic CARD rule to avoid mis-match
  [/[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/g, '[CN_ID]'],
  
  // Chinese mobile (11 digits, 1[3-9]xxxx)
  // BEFORE generic PHONE rule
  [/\b1[3-9]\d{9}\b/g, '[CN_PHONE]'],
  
  // Email
  [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]'],
  
  // Credit card (Visa/MC/AmEx/Discover)
  [/\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[CARD]'],
  
  // International phone (catch-all, AFTER CN_PHONE)
  [/\b\+?\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{4}\b/g, '[PHONE]'],
  
  // Password in config
  [/(password|passwd|pwd)\s*=\s*["']?([^"'\s&]+)/gi, '$1=[REDACTED]'],
];

const CODE_BLOCK_RE = /```[\s\S]*?```|`[^`\n]+`/g;

const META_TOPIC_PATTERNS = {
  email: /\b(regex|regexp|正则|正则表达式|format|格式|validation|验证|检测|pattern)\b/i,
  api_key: /(how\s+to|如何).*(key|密钥|token|format|格式)/i,
  credit_card: /(card\s*format|卡号格式|validation|luhn|mod\.10|check\s*digit)/i,
  phone: /(phone\s*format|手机号格式|国际区号|e\.164)/i,
};

const META_TOPIC_TO_REPLACEMENTS = {
  email: ['[EMAIL]'],
  api_key: ['[API_KEY_ANTHROPIC]', '[API_KEY_STRIPE]', '[API_KEY_GLM]', '[API_KEY_OPENAI]', '[TOKEN_GITHUB]'],
  credit_card: ['[CARD]'],
  phone: ['[PHONE]', '[CN_PHONE]'],
};

function detectMetaTopics(text) {
  const found = [];
  for (const [family, pattern] of Object.entries(META_TOPIC_PATTERNS)) {
    if (pattern.test(text)) found.push(family);
  }
  return found;
}

function applyRules(text, skipFamilies = []) {
  const skipReplacements = new Set();
  for (const family of skipFamilies) {
    const reps = META_TOPIC_TO_REPLACEMENTS[family] || [];
    reps.forEach(r => skipReplacements.add(r));
  }
  
  let result = text;
  for (const [pattern, replacement] of RULES) {
    const label = replacement.replace(/^\$1=/, '[REDACTED]');
    if (skipReplacements.has(label)) continue;
    const publicReplacement = /^\[[A-Z0-9_]+\]$/.test(replacement)
      ? '[REDACTED]'
      : replacement;
    result = result.replace(pattern, publicReplacement);
  }
  return result;
}

function redact(text, codeAware = true) {
  if (!codeAware) return applyRules(text, []);
  
  const skipFamilies = detectMetaTopics(text);
  
  const parts = [];
  let lastEnd = 0;
  
  for (const match of text.matchAll(CODE_BLOCK_RE)) {
    if (match.index > lastEnd) {
      parts.push(applyRules(text.slice(lastEnd, match.index), skipFamilies));
    }
    parts.push(match[0]);
    lastEnd = match.index + match[0].length;
  }
  if (lastEnd < text.length) {
    parts.push(applyRules(text.slice(lastEnd), skipFamilies));
  }
  
  return parts.join('');
}

const args = process.argv.slice(2);
const codeAware = !args.includes('--no-code-aware');
const input = args.find(a => !a.startsWith('--')) || fs.readFileSync(0, 'utf8');
console.log(redact(input.trim(), codeAware));

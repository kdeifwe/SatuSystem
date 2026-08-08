export function isValidLeadName(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const name = value.trim();
  if (!name) return false;
  if (name.length < 2 || name.length > 40) return false;

  // Reject obvious links, mentions, or long sequences of non-letter symbols
  const lower = name.toLowerCase();
  if (/https?:\/\//.test(lower) || /www\./.test(lower)) return false;
  if (/^@/.test(name)) return false;
  if (/\S+@\S+\.(com|ru|kz|kg|uz)/.test(lower)) return false;

  // Reject if too many non-letter characters (emojis/punctuation)
  const letters = (name.match(/[A-Za-zА-Яа-яЁёӘәҒғІіҢңҮүҰұҚқӨөҺһҢ]/gu) || []).length;
  const spaces = (name.match(/\s/g) || []).length;
  const others = name.length - letters - spaces;
  // require at least ~50% letters/spaces
  if (letters + spaces === 0) return false;
  if ((letters / name.length) < 0.45) return false;

  // Reject repeated emoji/symbol sequences like "🔥🔥🔥" or repeated punctuation
  if (/([!@#\$%\^&\*🔥⭐✳️🎉])\1{2,}/u.test(name)) return false;

  // Reject long all-caps strings or suspicious uppercase-heavy names
  const upperMatches = name.match(/[A-ZА-ЯЁӘҒІҢҮҰҚӨҺ]{3,}/u) || [];
  if (upperMatches.length > 0) {
    const upperCount = (name.match(/[A-ZА-ЯЁӘҒІҢҮҰҚӨҺ]/g) || []).length;
    if (upperCount / Math.max(1, name.replace(/\s/g, '').length) > 0.6) return false;
  }

  return true;
}

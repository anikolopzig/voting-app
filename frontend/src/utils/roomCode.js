// Room-code generation.
// 6 chars, uppercase letters + digits, excluding ambiguous glyphs 0 O 1 I L.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // note: no 0,O,1,I,L
const CODE_LENGTH = 6;

export function generateRoomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

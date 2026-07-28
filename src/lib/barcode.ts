const CODE_128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
] as const;

export type BarcodeUnit = { bar: boolean; width: number };

const EAN13_PREFIX = '290';
const EAN_L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
] as const;
const EAN_G = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
] as const;
const EAN_R = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
] as const;
const EAN_PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
] as const;

export function formatProductBarcode(sequence: number): string {
  return `LHB${String(sequence).padStart(6, '0')}`;
}

export function parseProductBarcodeSequence(value: string | null | undefined): number | null {
  const match = value?.match(/^LHB(\d{6,})$/);
  return match ? Number(match[1]) : null;
}

export function ean13CheckDigit(body: string): number {
  if (!/^\d{12}$/.test(body)) throw new Error('EAN-13 body must contain exactly 12 digits.');
  const sum = [...body].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return (10 - (sum % 10)) % 10;
}

export function formatRetailBarcode(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 999_999_999) {
    throw new Error('Retail barcode sequence must be between 1 and 999999999.');
  }
  const body = `${EAN13_PREFIX}${String(sequence).padStart(9, '0')}`;
  return `${body}${ean13CheckDigit(body)}`;
}

export function isValidEan13(value: string | null | undefined): value is string {
  if (!value || !/^\d{13}$/.test(value)) return false;
  return ean13CheckDigit(value.slice(0, 12)) === Number(value[12]);
}

export function isValidRetailBarcode(value: string | null | undefined): value is string {
  return isValidEan13(value) && value.startsWith(EAN13_PREFIX);
}

export function parseRetailBarcodeSequence(value: string | null | undefined): number | null {
  if (!isValidRetailBarcode(value)) return null;
  return Number(value.slice(3, 12));
}

export type Ean13Module = { bar: boolean; guard: boolean; index: number };

/** Encode a validated EAN-13 value into its 95 modules (quiet zones are added by renderers). */
export function encodeEan13(value: string): Ean13Module[] {
  if (!isValidEan13(value)) throw new Error('Invalid EAN-13 barcode.');
  const first = Number(value[0]);
  const parity = EAN_PARITY[first];
  const left = [...value.slice(1, 7)]
    .map((digit, index) => (parity[index] === 'L' ? EAN_L : EAN_G)[Number(digit)])
    .join('');
  const right = [...value.slice(7)].map((digit) => EAN_R[Number(digit)]).join('');
  const modules = `101${left}01010${right}101`;
  const guards = new Set([0, 2, 46, 48, 92, 94]);
  return [...modules].map((module, index) => ({
    bar: module === '1',
    guard: guards.has(index),
    index,
  }));
}

export function encodeCode128B(value: string): BarcodeUnit[] {
  if (!value || /[^\x20-\x7e]/.test(value)) {
    throw new Error('Code 128 subset B supports printable ASCII only.');
  }

  const codes = [104, ...[...value].map((char) => char.charCodeAt(0) - 32)];
  const checksum = codes.reduce((sum, code, index) => sum + (index === 0 ? code : code * index), 0) % 103;
  codes.push(checksum, 106);

  return codes.flatMap((code) => patternToUnits(CODE_128_PATTERNS[code]));
}

export function barcodeModuleCount(units: BarcodeUnit[]): number {
  return units.reduce((sum, unit) => sum + unit.width, 0);
}

function patternToUnits(pattern: string): BarcodeUnit[] {
  return [...pattern].map((digit, index) => ({
    bar: index % 2 === 0,
    width: Number(digit),
  }));
}

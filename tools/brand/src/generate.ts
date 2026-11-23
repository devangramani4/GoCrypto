/**
 * Writes every GoCrypto logo file from the shared definition in packages/ui/src/brand.ts:
 * favicons, the web home-screen icon, the desktop app icon, the Android launcher, themed and
 * notification icons, and the iOS app icon and launch-screen logo.
 *
 *   pnpm --filter @gocrypto/brand generate
 *
 * The in-app marks (packages/ui Logo, apps/mobile Logo) read brand.ts directly and need no files.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import { logo, type LogoGradient } from '@gocrypto/ui/brand';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

// ---------------------------------------------------------------------------------------------
// SVG artwork (100 × 100 canvas units)
// ---------------------------------------------------------------------------------------------

const linear = (id: string, g: LogoGradient): string =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}">` +
  g.stops.map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`).join('') +
  '</linearGradient>';

const glyphStroke = `fill="none" stroke-width="${logo.glyph.width}" stroke-linecap="round" stroke-linejoin="round"`;

/** The shield and its G, without a background. */
const markDefs = linear('shield', logo.shield.gradient);
const markBody = [
  `<path d="${logo.shield.path}" fill="url(#shield)"/>`,
  `<path d="${logo.shield.shade.path}" fill="${logo.shield.shade.color}" fill-opacity="${logo.shield.shade.opacity}"/>`,
  `<path d="${logo.shield.highlight.path}" fill="none" stroke="${logo.shield.highlight.color}" stroke-opacity="${logo.shield.highlight.opacity}" stroke-width="${logo.shield.highlight.width}" stroke-linecap="round"/>`,
  `<path d="${logo.glyph.path}" ${glyphStroke} stroke="${logo.glyph.shadow.color}" stroke-opacity="${logo.glyph.shadow.opacity}" transform="translate(${logo.glyph.shadow.dx} ${logo.glyph.shadow.dy})"/>`,
  `<path d="${logo.glyph.path}" ${glyphStroke} stroke="${logo.glyph.color}"/>`,
].join('');

/** The full app-icon tile: dark navy square with a soft blue glow behind the shield. */
const { glow } = logo.tile;
const tileDefs =
  linear('tile', logo.tile.gradient) +
  `<radialGradient id="glow" gradientUnits="userSpaceOnUse" cx="${glow.cx}" cy="${glow.cy}" r="${glow.r}">` +
  `<stop offset="0" stop-color="${glow.color}" stop-opacity="${glow.opacity}"/>` +
  `<stop offset="1" stop-color="${glow.color}" stop-opacity="0"/></radialGradient>` +
  markDefs;
const tileBody = `<rect width="100" height="100" fill="url(#tile)"/><circle cx="${glow.cx}" cy="${glow.cy}" r="${glow.r}" fill="url(#glow)"/>${markBody}`;

const svg = (viewBox: string, defs: string, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><defs>${defs}</defs>${body}</svg>\n`;

const markSvg = svg(logo.markViewBox, markDefs, markBody);
const tileSvg = svg(logo.tileViewBox, tileDefs, tileBody);

/** Tile clipped to a shape inside a larger canvas (legacy Android icons, desktop icon). */
function shapedTileSvg(canvas: number, shape: string, inset: number, size: number, shadow = false): string {
  const scale = size / 100;
  const shadowLayer = shadow
    ? `<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${canvas * 0.014}"/></filter>` +
      `<g filter="url(#shadow)" transform="translate(0 ${canvas * 0.012})"><g fill="#000000" fill-opacity="0.35">${shape}</g></g>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas} ${canvas}"><defs>${tileDefs}<clipPath id="shape">${shape}</clipPath></defs>` +
    `${shadowLayer}<g clip-path="url(#shape)"><g transform="translate(${inset} ${inset}) scale(${scale})">${tileBody}</g></g></svg>\n`
  );
}

// ---------------------------------------------------------------------------------------------
// Rasterising
// ---------------------------------------------------------------------------------------------

function render(source: string, size: number) {
  return new Resvg(source, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } }).render();
}

/** PNG with an alpha channel. */
const png = (source: string, size: number): Buffer => Buffer.from(render(source, size).asPng());

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * PNG without an alpha channel. Apple rejects app icons that have one, and iOS draws transparent
 * home-screen icons on black.
 */
function opaquePng(source: string, size: number): Buffer {
  const image = render(source, size);
  const { width, height } = image;
  const rgba = image.pixels;
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height); // each row starts with filter type 0 (none)
  for (let i = 0; i < width * height; i++) {
    if (rgba[i * 4 + 3] !== 255) throw new Error('An opaque icon has transparent pixels');
    const at = Math.floor(i / width) * stride + 1 + (i % width) * 3;
    raw[at] = rgba[i * 4] as number;
    raw[at + 1] = rgba[i * 4 + 1] as number;
    raw[at + 2] = rgba[i * 4 + 2] as number;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Android vector drawables
// ---------------------------------------------------------------------------------------------

const GENERATED = '<!-- Generated by tools/brand from packages/ui/src/brand.ts: edit those, not this file. -->';

/** #RRGGBB + opacity → #AARRGGBB. */
const argb = (hex: string, opacity = 1): string =>
  `#${Math.round(opacity * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()}${hex.slice(1).toUpperCase()}`;

const androidLinear = (g: LogoGradient, indent: string): string =>
  [
    `${indent}<aapt:attr name="android:fillColor">`,
    `${indent}    <gradient android:type="linear" android:startX="${g.x1}" android:startY="${g.y1}" android:endX="${g.x2}" android:endY="${g.y2}">`,
    ...g.stops.map(
      ([offset, color]) => `${indent}        <item android:offset="${offset}" android:color="${argb(color)}" />`,
    ),
    `${indent}    </gradient>`,
    `${indent}</aapt:attr>`,
  ].join('\n');

const vector = (size: number, body: string[], aapt = false): string =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    GENERATED,
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"' +
      (aapt ? '\n    xmlns:aapt="http://schemas.android.com/aapt"' : ''),
    `    android:width="${size}dp"`,
    `    android:height="${size}dp"`,
    `    android:viewportWidth="${size}"`,
    `    android:viewportHeight="${size}">`,
    ...body,
    '</vector>',
    '',
  ].join('\n');

/**
 * Adaptive icons are 108 dp layers of which launchers show the middle 72 dp (66 dp is always
 * visible), so the 100-unit tile maps onto the middle 72 dp. The shield stays within the 66 dp zone.
 */
const ADAPTIVE_GROUP =
  '    <group android:translateX="18" android:translateY="18" android:scaleX="0.72" android:scaleY="0.72">';

const adaptiveBackground = vector(
  108,
  [
    ADAPTIVE_GROUP,
    '        <path android:pathData="M-25,-25h150v150h-150z">',
    androidLinear(logo.tile.gradient, '            '),
    '        </path>',
    '        <path android:pathData="M-25,-25h150v150h-150z">',
    '            <aapt:attr name="android:fillColor">',
    `                <gradient android:type="radial" android:centerX="${glow.cx}" android:centerY="${glow.cy}" android:gradientRadius="${glow.r}">`,
    `                    <item android:offset="0" android:color="${argb(glow.color, glow.opacity)}" />`,
    `                    <item android:offset="1" android:color="${argb(glow.color, 0)}" />`,
    '                </gradient>',
    '            </aapt:attr>',
    '        </path>',
    '    </group>',
  ],
  true,
);

const androidGlyph = (indent: string, color: string, opacity: number): string =>
  [
    `${indent}<path`,
    `${indent}    android:pathData="${logo.glyph.path}"`,
    `${indent}    android:fillColor="#00000000"`,
    `${indent}    android:strokeColor="${argb(color)}"`,
    ...(opacity < 1 ? [`${indent}    android:strokeAlpha="${opacity}"`] : []),
    `${indent}    android:strokeWidth="${logo.glyph.width}"`,
    `${indent}    android:strokeLineCap="round"`,
    `${indent}    android:strokeLineJoin="round" />`,
  ].join('\n');

const adaptiveForeground = vector(
  108,
  [
    ADAPTIVE_GROUP,
    `        <path android:pathData="${logo.shield.path}">`,
    androidLinear(logo.shield.gradient, '            '),
    '        </path>',
    '        <path',
    `            android:pathData="${logo.shield.shade.path}"`,
    `            android:fillColor="${argb(logo.shield.shade.color)}"`,
    `            android:fillAlpha="${logo.shield.shade.opacity}" />`,
    '        <path',
    `            android:pathData="${logo.shield.highlight.path}"`,
    '            android:fillColor="#00000000"',
    `            android:strokeColor="${argb(logo.shield.highlight.color)}"`,
    `            android:strokeAlpha="${logo.shield.highlight.opacity}"`,
    `            android:strokeWidth="${logo.shield.highlight.width}"`,
    '            android:strokeLineCap="round" />',
    `        <group android:translateX="${logo.glyph.shadow.dx}" android:translateY="${logo.glyph.shadow.dy}">`,
    androidGlyph('            ', logo.glyph.shadow.color, logo.glyph.shadow.opacity),
    '        </group>',
    androidGlyph('        ', logo.glyph.color, 1),
    '    </group>',
  ],
  true,
);

/** One colour, G cut out of the shield: Android 13+ themed icons tint this with the wallpaper colour. */
const cutOut = (indent: string): string =>
  [
    `${indent}<path`,
    `${indent}    android:pathData="${logo.shield.path}${logo.glyph.outline}"`,
    `${indent}    android:fillColor="#FFFFFFFF"`,
    `${indent}    android:fillType="evenOdd" />`,
  ].join('\n');

const adaptiveMonochrome = vector(108, [ADAPTIVE_GROUP, cutOut('        '), '    </group>']);

/** Status-bar icon: white silhouette, 22 dp tall inside the 24 dp icon. */
const NOTIFICATION_SCALE = 22 / 77; // the shield is 77 units tall
const notification = vector(24, [
  `    <group android:translateX="${+(12 - 50 * NOTIFICATION_SCALE).toFixed(3)}" android:translateY="${+(12 - 50.5 * NOTIFICATION_SCALE).toFixed(3)}" android:scaleX="${+NOTIFICATION_SCALE.toFixed(4)}" android:scaleY="${+NOTIFICATION_SCALE.toFixed(4)}">`,
  cutOut('        '),
  '    </group>',
]);

const adaptiveIcon = [
  '<?xml version="1.0" encoding="utf-8"?>',
  GENERATED,
  '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
  '    <background android:drawable="@drawable/ic_launcher_background" />',
  '    <foreground android:drawable="@drawable/ic_launcher_foreground" />',
  '    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />',
  '</adaptive-icon>',
  '',
].join('\n');

// ---------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------

const files = new Map<string, string | Buffer>();

// Web (also the desktop renderer) and admin.
files.set('apps/web/public/favicon.svg', markSvg);
files.set('apps/admin/public/favicon.svg', markSvg);
files.set('apps/web/public/apple-touch-icon.png', opaquePng(tileSvg, 180));

// Desktop: electron-builder makes the Windows .ico and macOS .icns from this. macOS icon grid:
// an 824 px rounded square with a soft shadow in a 1024 px canvas.
files.set(
  'apps/desktop/resources/icon.png',
  png(shapedTileSvg(1024, '<rect x="100" y="100" width="824" height="824" rx="185"/>', 100, 824, true), 1024),
);

// Android.
const res = 'apps/mobile/android/app/src/main/res';
files.set(`${res}/drawable/ic_launcher_background.xml`, adaptiveBackground);
files.set(`${res}/drawable/ic_launcher_foreground.xml`, adaptiveForeground);
files.set(`${res}/drawable/ic_launcher_monochrome.xml`, adaptiveMonochrome);
files.set(`${res}/drawable/ic_notification.xml`, notification);
files.set(`${res}/mipmap-anydpi-v26/ic_launcher.xml`, adaptiveIcon);
files.set(`${res}/mipmap-anydpi-v26/ic_launcher_round.xml`, adaptiveIcon);
// Launchers before Android 8 use these bitmaps (48 dp, artwork 44 dp).
const legacySquare = shapedTileSvg(48, '<rect x="2" y="2" width="44" height="44" rx="8"/>', 2, 44);
const legacyRound = shapedTileSvg(48, '<circle cx="24" cy="24" r="22"/>', 2, 44);
for (const [density, px] of [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
] as const) {
  files.set(`${res}/mipmap-${density}/ic_launcher.png`, png(legacySquare, px));
  files.set(`${res}/mipmap-${density}/ic_launcher_round.png`, png(legacyRound, px));
}

// iOS: one 1024 px icon (Xcode makes the other sizes), and the launch-screen logo at 96 pt.
const assets = 'apps/mobile/ios/GoCrypto/Images.xcassets';
files.set(`${assets}/AppIcon.appiconset/AppIcon-1024.png`, opaquePng(tileSvg, 1024));
files.set(`${assets}/LaunchLogo.imageset/LaunchLogo.png`, png(markSvg, 96));
files.set(`${assets}/LaunchLogo.imageset/LaunchLogo@2x.png`, png(markSvg, 192));
files.set(`${assets}/LaunchLogo.imageset/LaunchLogo@3x.png`, png(markSvg, 288));
files.set(
  `${assets}/LaunchLogo.imageset/Contents.json`,
  JSON.stringify(
    {
      images: ['', '@2x', '@3x'].map((suffix, i) => ({
        filename: `LaunchLogo${suffix}.png`,
        idiom: 'universal',
        scale: `${i + 1}x`,
      })),
      info: { author: 'xcode', version: 1 },
    },
    null,
    2,
  ) + '\n',
);

for (const [path, data] of files) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
}
process.stdout.write(`Wrote ${files.size} logo files:\n${[...files.keys()].map((p) => `  ${p}`).join('\n')}\n`);

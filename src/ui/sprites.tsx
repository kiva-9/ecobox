// 原创像素风图标与插画：全部由字符网格程序化渲染为 SVG 矩形（无外部图片资源）。
// 调色板与 shared/protocol.ts 的 PALETTE 保持一致，保证与游戏内像素场景协调。

import type { ReactElement } from 'react';
import { PALETTE } from '../shared/protocol';

/** 字符 → 颜色。'.' 表示透明。 */
const P: Record<string, string> = {
  k: PALETTE.ink,
  w: PALETTE.panel,
  a: PALETTE.panelEdge,
  g: PALETTE.grass,
  G: PALETTE.woodland,
  m: PALETTE.meadowDark,
  b: PALETTE.water,
  B: PALETTE.waterDeep,
  r: PALETTE.rock,
  y: PALETTE.arid,
  Y: PALETTE.aridDark,
  o: PALETTE.accent,
  p: PALETTE.shrub,
  s: PALETTE.species[0],
  S: PALETTE.speciesDark[0],
  n: PALETTE.species[1],
  N: PALETTE.speciesDark[1],
  d: PALETTE.species[2],
  D: PALETTE.speciesDark[2],
  v: PALETTE.species[3],
  V: PALETTE.speciesDark[3],
  e: '#f2c14e', // 暖黄（太阳/高光）
  t: '#7a5c3a', // 树干棕
};

export interface Sprite {
  rows: string[];
}

function normalize(rows: string[], w: number, h: number): string[] {
  const out: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = rows[y] ?? '';
    if (row.length < w) row += '.'.repeat(w - row.length);
    out.push(row.slice(0, w));
  }
  return out;
}

function sprite(rows: string[], w = 12, h = 12): Sprite {
  return { rows: normalize(rows, w, h) };
}

// ---------------------------------------------------------------- 图标集

export const SPRITES = {
  // 工具
  cursor: sprite([
    '............',
    '.kk.........',
    '.kwk........',
    '.kwwk.......',
    '.kwwwk......',
    '.kwwwwk.....',
    '.kwwwwwk....',
    '.kwwwwk.....',
    '.kwwkkk.....',
    '.kwk..k.....',
    'kk...k......',
    '............',
  ]),
  brush: sprite([
    '.........kk.',
    '........kwwk',
    '.......kwwk.',
    '......kwwk..',
    '.....kwwk...',
    '....kwwk....',
    '...kwwk.....',
    '..kwok......',
    '.koook......',
    'kooook......',
    '.ooo........',
    '............',
  ]),
  meadow: sprite([
    '............',
    '..g...g..g..',
    '.ggg.ggg.gg.',
    'gggggggggggg',
    'gmgggmgggmgg',
    'gggggggggggg',
    'ggmggggmgggg',
    'gggggggggggg',
    'ggggggmggggg',
    'ggmggggggmgg',
    'gggggggggggg',
    '............',
  ]),
  woodland: sprite([
    '............',
    '...G....G...',
    '..GGG..GGG..',
    '.GGGGG.GGGG.',
    'GGGGGGGGGGGG',
    'GGaGGGGGaGGG',
    'GGGGGGGGGGGG',
    'GGGGGaGGGGGG',
    'GGGGGGGGGGGG',
    'GGaGGGGGGaGG',
    'GGGGGGGGGGGG',
    '............',
  ]),
  arid: sprite([
    '............',
    'yyyyyyyyyyyy',
    'yYyyyyyyYyyy',
    'yyyyyYyyyyyy',
    'yYyyyyyyyYyy',
    'yyyyYyyyyyyy',
    'yyyyyyyyyYyy',
    'yYyyyyyYyyyy',
    'yyyyyyYyyyyy',
    'yYyyyyyyyyYy',
    'yyyyyyyyyyyy',
    '............',
  ]),
  water: sprite([
    '............',
    'bbbbbbbbbbbb',
    'bBbbbbbbBbbb',
    'bbbbbbBbbbbb',
    'bbBbbbbbbbbb',
    'bbbbbbbbBbbb',
    'bBbbbbbBbbbb',
    'bbbbBbbbbbbb',
    'bbbbbbbbBbbb',
    'bBbbbbbbbbBb',
    'bbbbbbbbbbbb',
    '............',
  ]),
  rock: sprite([
    '............',
    '....rrr.....',
    '...rrrrr....',
    '..rrrrrrr...',
    '.rrrrrrrrr..',
    'rrrrrrrrrrrr',
    '.rrrrkrrrr..',
    'rrrrrrrrrrrr',
    '.rrrrrrrrr..',
    '..rrkrrrr...',
    '...rrrrr....',
    '............',
  ]),
  seed: sprite([
    '............',
    '...g..g.....',
    '..g.g.g.....',
    '..ggggg.....',
    '.ggGgggg....',
    '.ggGgggg....',
    '..ggggg.....',
    '...g.g......',
    '..g...g.....',
    '.g.....g....',
    '............',
    '............',
  ]),
  shrub: sprite([
    '............',
    '....GG......',
    '...GGGG.....',
    '..GGppGG....',
    '.GGpGGpGG...',
    '.GGpGGpGG...',
    '..GGppGG....',
    '...GGGG.....',
    '....tt......',
    '....tt......',
    '...tttt.....',
    '............',
  ]),
  rain: sprite([
    '............',
    '....wwww....',
    '..wwwwwwww..',
    '.wwwwwwwwww.',
    'wwwwwwwwwwww',
    '..a..a..a...',
    '.b...b...b..',
    '....b...b...',
    '..b....b....',
    '.b......b...',
    '............',
    '............',
  ]),
  drought: sprite([
    '.....e......',
    '..e..e..e...',
    '...eeeee....',
    'e..eeeee..e.',
    '..eeyyyee...',
    '.eyyYYyyye..',
    '.eyyYYyyyye.',
    '..eyyYYyye..',
    'e..eyyye..e.',
    '...eeeee....',
    '..e..e..e...',
    '.....e......',
  ]),
  // 物种
  herbS: sprite([
    '............',
    '............',
    '............',
    '...kkkk.....',
    '..ksssk.....',
    '..kskssk....',
    '.ksssssk....',
    '.kssssskk...',
    '..ksssk.k...',
    '...kkk..k...',
    '...k..k.....',
    '............',
  ]),
  herbL: sprite([
    '............',
    '............',
    '....kkkk....',
    '...knnnnk...',
    '..knnknnnk..',
    '.knnnnnnnnk.',
    '.knnnnnnnnkk',
    '..knnnnnk.k.',
    '...knnk..k..',
    '...kk...k...',
    '...k...k....',
    '............',
  ]),
  pred: sprite([
    '............',
    '..k......k..',
    '..kk....kk..',
    '..kdk..kdk..',
    '.kddddkdddk.',
    '.kddddddddk.',
    '.kdDddddDdk.',
    '..kddddddk..',
    '...kddddk...',
    '...k.k.k....',
    '..k...k.....',
    '............',
  ]),
  scav: sprite([
    '............',
    '............',
    '............',
    '....kkkk....',
    '...kvvvvk...',
    '..kvkvvkvk..',
    '.kvvvvvvvvk.',
    '.kvvvvvvvvk.',
    '..kvvVvvvk..',
    '...kvvvvk...',
    '...k.k.k....',
    '............',
  ]),
  // 标签页
  tabCreature: sprite([
    '............',
    '..kkk.......',
    '.kwwwk......',
    '.kwkwk.kk...',
    '.kwwwkkwwk..',
    '..kkk.kwwwk.',
    '......kwwwwk',
    '......kwwwk.',
    '.......kkkk.',
    '............',
    '............',
    '............',
  ]),
  tabLineage: sprite([
    '............',
    '......kk....',
    '.....kGGk...',
    '....kGGGGk..',
    '...kGGGGGGk.',
    '..kkGGGGGGkk',
    '....kGGGGk..',
    '.....kGGk...',
    '......kk....',
    '......tt....',
    '.....ttt....',
    '............',
  ]),
  tabData: sprite([
    '............',
    '............',
    '..g.....d...',
    '..g.....d...',
    '..g..n..d...',
    '..g..n..d...',
    '..g..n..d.v.',
    '..g..n..d.v.',
    '..g..n..d.v.',
    '..ggndddvvv.',
    '..kkkkkkkkk.',
    '............',
  ]),
  tabChallenge: sprite([
    '............',
    '..kkkkk.....',
    '..kooooook..',
    '..kooooook..',
    '..kooooook..',
    '..koooooook.',
    '..kooooook..',
    '..kooooook..',
    '..kooooook..',
    '..kkkkkkkk..',
    '......k.....',
    '.....kkk....',
  ]),
  tabWorld: sprite([
    '....kkkk....',
    '..kkGGGGkk..',
    '.kGGGGGGGGk.',
    'kGGwwkGGwwkk',
    'kGGwGGGGwGkk',
    'kGGGGGGGGGkk',
    'kGGGGGGGGGGk',
    'kGGwGGGGwGGk',
    '.kGGwwkGGGGk',
    '..kkGGGGGkk.',
    '....kkkk....',
    '............',
  ]),
  // 顶栏动作
  menu: sprite([
    '............',
    '.kkkkkkkkkk.',
    '.koooooooook',
    '.koooooooook',
    '.koooooooook',
    '.koooooooook',
    '.koooooooook',
    '.koooooooook',
    '.koooooooook',
    '.kkkkkkkkkk.',
    '............',
    '............',
  ]),
  save: sprite([
    '............',
    '.aaaaaaaa..',
    '.akkkkkkak.',
    '.akkkkkkak.',
    '.akkkkkkkk.',
    '.akkkkkkkk.',
    '.akwwwwwwk.',
    '.akwkkwkwk.',
    '.akwwwwwwk.',
    '.akwkwkkwk.',
    '.akwwwwwwk.',
    '.kkkkkkkkk.',
  ]),
  load: sprite([
    '............',
    '..kkkkkk....',
    '.kaaaaaak...',
    '.kak..kak...',
    '.kak..kak...',
    '.kak..kak...',
    '.kak..kak...',
    '.kaaaaaak...',
    '..kkkkkk....',
    '............',
    '............',
    '............',
  ]),
  export: sprite([
    '............',
    '.....kk.....',
    '.....kwk....',
    '.....kwk....',
    '..kkkkkwkkk.',
    '..kwwwwwwk..',
    '..kwkkkkwk..',
    '..kwwwwwwk..',
    '..kwkkkkwk..',
    '..kwwwwwwk..',
    '..kkkkkkkk..',
    '............',
  ]),
  import: sprite([
    '............',
    '..kkkkkkkk..',
    '..kwwwwwwk..',
    '..kwkkkkwk..',
    '..kwwwwwwk..',
    '..kwkkkkwk..',
    '..kwwwwwwk..',
    '..kkkkkwkkk.',
    '.....kwk....',
    '.....kwk....',
    '.....kk.....',
    '............',
  ]),
  help: sprite([
    '...kkkkk....',
    '..kwwwwwk...',
    '.kww...wwk..',
    '.kww...wwk..',
    '......kwwk..',
    '.....kwwk...',
    '.....kwwk...',
    '.....kkkk...',
    '.....kwwk...',
    '.....kwwk...',
    '.....kkkk...',
    '............',
  ]),
  settings: sprite([
    '............',
    '...kkkkk....',
    '..kk...kk...',
    '.kk..k..kk..',
    '....kkk.....',
    '...kkkkk....',
    '..kkkkkkk...',
    '...kkkkk....',
    '....kkk.....',
    '..kk...kk...',
    '...kkkkk....',
    '............',
  ]),
  close: sprite([
    '............',
    '..kk...kk...',
    '..kkk.kkk...',
    '...kkkkk....',
    '....kkk.....',
    '....kkk.....',
    '....kkk.....',
    '...kkkkk....',
    '..kkk.kkk...',
    '..kk...kk...',
    '............',
    '............',
  ]),
  check: sprite([
    '............',
    '.........kk.',
    '........kwwk',
    '.......kwwk.',
    '..kk..kwwk..',
    '.kwwkkwwk...',
    '.kwwwwwk....',
    '..kwwwwk....',
    '...kwwk.....',
    '....kk......',
    '............',
    '............',
  ]),
  warn: sprite([
    '............',
    '.....kk.....',
    '....kkkk....',
    '...kk..kk...',
    '..kk....kk..',
    '..kk.kk.kk..',
    '.kk.kkkk.kk.',
    '.kk.kkkk.kk.',
    'kk..kkkk..kk',
    'kkk..kk..kkk',
    '.kk......kk.',
    '..kkkkkkkk..',
  ]),
  info: sprite([
    '............',
    '....kkk.....',
    '...kwwwk....',
    '...kwwwk....',
    '....kkk.....',
    '....kwk.....',
    '....kwk.....',
    '....kwk.....',
    '....kwk.....',
    '....kwk.....',
    '....kkk.....',
    '............',
  ]),
  err: sprite([
    '............',
    '..kk....kk..',
    '..kkk..kkk..',
    '...kkkkkk...',
    '....kkkk....',
    '.....kk.....',
    '.....kk.....',
    '....kkkk....',
    '...kkkkkk...',
    '..kkk..kkk..',
    '..kk....kk..',
    '............',
  ]),
  dice: sprite([
    '............',
    '..kkkkkkk...',
    '.kwwwwwwwk..',
    '.kwkkkwkwk..',
    '.kwkkkwkwk..',
    '.kwwwwwwwk..',
    '.kwkwkkkwk..',
    '.kwkwkkkwk..',
    '.kwwwwwwwk..',
    '.kwkkwkwkwk.',
    '..kkkkkkkk..',
    '............',
  ]),
  zoomIn: sprite([
    '............',
    '......kk....',
    '......kwk...',
    '......kwk...',
    '..kkkkkwkkk.',
    '..kwwwwwwk..',
    '..kwwkkwwk..',
    '..kwwwwwwk..',
    '..kkkkkwkkk.',
    '......kwk...',
    '......kwk...',
    '......kk....',
  ]),
  zoomOut: sprite([
    '............',
    '............',
    '............',
    '............',
    '..kkkkkkkkk.',
    '..kwwwwwwwk.',
    '..kwwwwwwwk.',
    '..kwwwwwwwk.',
    '..kkkkkkkkk.',
    '............',
    '............',
    '............',
  ]),
  play: sprite([
    '............',
    '..kk........',
    '..kwkk......',
    '..kwwwkk....',
    '..kwwwwwkk..',
    '..kwwwwwwwk.',
    '..kwwwwwwwk.',
    '..kwwwwwkk..',
    '..kwwwkk....',
    '..kwkk......',
    '..kk........',
    '............',
  ]),
  pause: sprite([
    '............',
    '..kk..kk....',
    '..kwk.kwk...',
    '..kwk.kwk...',
    '..kwk.kwk...',
    '..kwk.kwk...',
    '..kwk.kwk...',
    '..kwk.kwk...',
    '..kwk.kwk...',
    '..kwk.kwk...',
    '..kk..kk....',
    '............',
  ]),
  step: sprite([
    '............',
    '..kk...kk...',
    '..kwkk.kwk..',
    '..kwwwkkwk..',
    '..kwwwwwkwk.',
    '..kwwwwwwwk.',
    '..kwwwwwwwk.',
    '..kwwwwwkwk.',
    '..kwwwkkwk..',
    '..kwkk.kwk..',
    '..kk...kk...',
    '............',
  ]),
  track: sprite([
    '............',
    '.....kk.....',
    '.....kwk....',
    '..k..kwk..k.',
    '.....kwk....',
    'kkkkkwkkkkk.',
    'kwwwwkkwwwwk',
    'kkkkkwkkkkk.',
    '.....kwk....',
    '..k..kwk..k.',
    '.....kwk....',
    '.....kk.....',
  ]),
  mute: sprite([
    '............',
    '............',
    '.....kk.....',
    '....kwkk....',
    '..kkwwwwk...',
    'kkwwwwwwkk..',
    'kkwwwwwwkkk.',
    '..kkwwwwk.k.',
    '....kwkk.k..',
    '.....kk.k...',
    '..........k.',
    '............',
  ]),
  vol: sprite([
    '............',
    '.....kk.....',
    '....kwkk....',
    '..kkwwwwk...',
    'kkwwwwwwkk.k',
    'kkwwwwwwk..k',
    'kkwwwwwwkk.k',
    '..kkwwwwk...',
    '....kwkk....',
    '.....kk.....',
    '............',
    '............',
  ]),
  sun: sprite([
    '.....e......',
    '..e..e..e...',
    '...eeeee....',
    'e..eeeee..e.',
    '..eeyyyee...',
    '.eyyYYyyye..',
    '.eyyYYyyye..',
    '..eeyyee.e..',
    'e..eeeee..e.',
    '...eeeee....',
    '..e..e..e...',
    '.....e......',
  ]),
  moon: sprite([
    '............',
    '.....kkk....',
    '...kkwwwk...',
    '..kwwwwwwk..',
    '.kwwkkkwwwk.',
    '.kwwkkkwwwk.',
    '.kwwkkkwwwk.',
    '.kwwwwwwwk..',
    '..kwwwwwk...',
    '...kkwwwk...',
    '.....kkk....',
    '............',
  ]),
  spark: sprite([
    '............',
    '.....k......',
    '.....k......',
    '....kwk.....',
    '...kwwwk....',
    '..kwwewwk...',
    'k.kwewewk.k.',
    '..kwwewwk...',
    '...kwwwk....',
    '....kwk.....',
    '.....k......',
    '.....k......',
  ]),
  clock: sprite([
    '....kkkk....',
    '..kkwwwwkk..',
    '.kwwkkkkwwk.',
    'kwwkk..kkwwk',
    'kwwk....kwwk',
    'kwwk.kk.kwwk',
    'kwwkk..kkwwk',
    '.kwwkkkkwwk.',
    '..kkwwwwkk..',
    '....kkkk....',
    '............',
    '............',
  ]),
  flag: sprite([
    '..kk........',
    '..kwk.......',
    '..kwkkkkkk..',
    '..kwooooook.',
    '..kwkkkkkook',
    '..kwooooook.',
    '..kwkkkkkk..',
    '..kwk.......',
    '..kwk.......',
    '..kwk.......',
    '.kkwkk......',
    '............',
  ]),
  globe: sprite([
    '....kkkk....',
    '..kkGGGGkk..',
    '.kGGGGGGGGk.',
    'kGGwwkGGwwkk',
    'kGGwGGGGwGkk',
    'kGGGGGGGGGkk',
    'kGGGGGGGGGGk',
    'kGGwGGGGwGGk',
    '.kGGwwkGGGGk',
    '..kkGGGGGkk.',
    '....kkkk....',
    '............',
  ]),
  birth: sprite([
    '............',
    '....kkk.....',
    '...kwwwk....',
    '..kwwwwwk...',
    '.kwwkeewwk..',
    '.kwweeeewk..',
    '.kwweeeewk..',
    '.kwwkeewwk..',
    '..kwwwwwk...',
    '...kwwwk....',
    '....kkk.....',
    '............',
  ]),
  death: sprite([
    '............',
    '............',
    'kk........kk',
    'kwk......kwk',
    '.kwk....kwk.',
    '..kwk..kwk..',
    '...kwkkwk...',
    '....kwkw....',
    '...kwkkwk...',
    '..kwk..kwk..',
    '.kwk....kwk.',
    'kk........kk',
  ]),
  cloud: sprite([
    '............',
    '............',
    '....wwww....',
    '..wwwwwwww..',
    '.wwwwwwwwww.',
    'wwwwwwwwwwww',
    '..a..a..a...',
    '.b...b...b..',
    '....b...b...',
    '..b....b....',
    '.b......b...',
    '............',
  ]),
  tree: sprite([
    '......kk....',
    '.....kGGk...',
    '....kGGGGk..',
    '...kGGGGGGk.',
    '..kkGGGGGGkk',
    '....kGGGGk..',
    '.....kGGk...',
    '......kk....',
    '......tt....',
    '.....ttt....',
    '.....ttt....',
    '....ttttt...',
  ]),
  world: sprite([
    '....kkkk....',
    '..kkGGGGkk..',
    '.kGGGGGGGGk.',
    'kGGwwkGGwwkk',
    'kGGwGGGGwGkk',
    'kGGGGGGGGGkk',
    'kGGGGGGGGGGk',
    'kGGwGGGGwGGk',
    '.kGGwwkGGGGk',
    '..kkGGGGGkk.',
    '....kkkk....',
    '............',
  ]),
  dna: sprite([
    '..kk..kk....',
    '.kwwkkwwk...',
    '.kwk..kwk...',
    '..kk..kk....',
    '..kk..kk....',
    '.kwwkkwwk...',
    '.kwk..kwk...',
    '.kwwkkwwk...',
    '..kk..kk....',
    '..kk..kk....',
    '.kwwkkwwk...',
    '.kwk..kwk...',
  ]),
  eye: sprite([
    '............',
    '...kkkkk....',
    '.kkwwwwwkk..',
    'kkwwkkkwwwk.',
    'kwwk...kwwk.',
    'kwwk...kwwk.',
    'kwwkkkkkwwk.',
    '.kkwwwwwkk..',
    '...kkkkk....',
    '............',
    '............',
    '............',
  ]),
  reset: sprite([
    '............',
    '....kkkk....',
    '..kk....kk..',
    '.kk......kk.',
    'kk........kk',
    'kk..kkkk..kk',
    'kk.kwwwwk.kk',
    '.k.kwwwwk.k.',
    '..kkwwwwkk..',
    '....kwwk....',
    '.....kk.....',
    '............',
  ]),
  folder: sprite([
    '............',
    '.kkkkkk.....',
    '.kaaaaak....',
    '.kkkkkkkkkk.',
    '.kak....kak.',
    '.kak.kk.kak.',
    '.kak.kw.kak.',
    '.kak.kw.kak.',
    '.kak.kk.kak.',
    '.kaaaaaaaak.',
    '.kkkkkkkkkk.',
    '............',
  ]),
} as const;

export type SpriteName = keyof typeof SPRITES;

// ---------------------------------------------------------------- 图标组件

export interface PixelIconProps {
  name: SpriteName;
  size?: number;
  className?: string;
  title?: string;
}

export function PixelIcon({ name, size = 18, className, title }: PixelIconProps): ReactElement {
  const sp = SPRITES[name];
  const w = 12;
  const h = sp.rows.length;
  const cells: ReactElement[] = [];
  for (let y = 0; y < h; y++) {
    const row = sp.rows[y];
    for (let x = 0; x < w; x++) {
      const color = P[row[x]];
      if (!color) continue;
      cells.push(<rect key={`${x}:${y}`} x={x} y={y} width={1} height={1} fill={color} />);
    }
  }
  const px = Math.max(1, Math.round(size / w));
  return (
    <svg
      className={className}
      width={px * w}
      height={px * h}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      focusable="false"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      style={{ display: 'block', flex: '0 0 auto' }}
    >
      {title ? <title>{title}</title> : null}
      {cells}
    </svg>
  );
}

// ---------------------------------------------------------------- 主菜单插画（程序化生成）

const SCENE_W = 80;
const SCENE_H = 40;

const SCENE_PAL: Record<string, string> = {
  '1': '#f7ecd9', // 天空（暖纸色）
  '2': '#f2c14e', // 太阳
  '3': '#fdfaf2', // 云
  '4': '#a9c47a', // 远山
  '5': PALETTE.meadow, // 近坡
  '6': PALETTE.meadowDark, // 近坡暗部
  '7': PALETTE.water, // 水
  '8': PALETTE.waterDeep, // 深水
  '9': PALETTE.woodland, // 树冠
  a: PALETTE.woodlandDark,
  b: '#7a5c3a', // 树干
  c: PALETTE.shrub, // 花
  d: PALETTE.arid, // 岸沙
};

/** 简易线性同余 RNG，保证插画每次渲染一致 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function paste(grid: string[][], sp: Sprite, ox: number, oy: number): void {
  for (let y = 0; y < sp.rows.length; y++) {
    for (let x = 0; x < 12; x++) {
      const c = sp.rows[y][x];
      if (c === '.') continue;
      const gx = ox + x;
      const gy = oy + y;
      if (gx < 0 || gy < 0 || gx >= SCENE_W || gy >= SCENE_H) continue;
      grid[gy][gx] = c;
    }
  }
}

function buildScene(): string[][] {
  const rnd = lcg(20260101);
  const grid: string[][] = [];
  for (let y = 0; y < SCENE_H; y++) grid.push(new Array<string>(SCENE_W).fill('1'));

  // 太阳与云
  const sunX = 63;
  const sunY = 7;
  for (let y = -4; y <= 4; y++) {
    for (let x = -4; x <= 4; x++) {
      if (x * x + y * y <= 9) grid[sunY + y][sunX + x] = '2';
    }
  }
  for (const [cx, cy] of [
    [12, 5],
    [34, 3],
    [52, 8],
  ] as const) {
    const w = 6 + Math.floor(rnd() * 4);
    for (let x = 0; x < w; x++) {
      grid[cy][cx + x] = '3';
      grid[cy - 1][cx + Math.floor(x / 2)] = '3';
      grid[cy + 1][cx + Math.floor(x / 3)] = '3';
    }
  }

  // 远山
  for (let x = 0; x < SCENE_W; x++) {
    const h = 13 + Math.round(2.5 * Math.sin(x / 9) + 1.5 * Math.sin(x / 3.7 + 1));
    for (let y = h; y < 21; y++) grid[y][x] = '4';
  }
  // 近坡
  const hillTop: number[] = [];
  for (let x = 0; x < SCENE_W; x++) {
    const h = 21 + Math.round(3.5 * Math.sin(x / 7 + 1) + 1.8 * Math.sin(x / 2.9));
    hillTop.push(h);
    for (let y = h; y < SCENE_H; y++) grid[y][x] = y === h ? '6' : '5';
  }

  // 河流（穿过谷地）
  for (let y = 19; y < SCENE_H; y++) {
    const xc = 38 + Math.round(6 * Math.sin(y / 5.5));
    const half = y > 30 ? 3 : 2;
    for (let x = xc - half; x <= xc + half; x++) {
      if (x < 0 || x >= SCENE_W) continue;
      const edge = Math.abs(x - xc) === half;
      grid[y][x] = edge && (x + y) % 3 === 0 ? '8' : '7';
    }
    // 河岸沙
    if (y % 4 === 0) {
      const lx = xc - half - 1;
      const rx = xc + half + 1;
      if (lx >= 0 && hillTop[lx] <= y) grid[y][lx] = 'd';
      if (rx < SCENE_W && hillTop[rx] <= y) grid[y][rx] = 'd';
    }
  }

  // 树木与草丛
  for (let x = 3; x < SCENE_W - 3; x += 5 + Math.floor(rnd() * 3)) {
    const y = hillTop[x];
    if (y < 16 || y > 30) continue;
    if (Math.abs(x - 38) < 7) continue; // 避开河道
    paste(grid, SPRITES.tree, x - 5, y - 10);
  }
  for (let i = 0; i < 46; i++) {
    const x = Math.floor(rnd() * SCENE_W);
    const y = 24 + Math.floor(rnd() * (SCENE_H - 24));
    if (grid[y][x] === '5' || grid[y][x] === '6') grid[y][x] = '6';
  }
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(rnd() * SCENE_W);
    const y = 23 + Math.floor(rnd() * (SCENE_H - 23));
    if (grid[y][x] === '5') grid[y][x] = 'c';
  }

  // 生物（手绘小剪影）
  paste(grid, SPRITES.herbS, 8, 25);
  paste(grid, SPRITES.herbS, 16, 30);
  paste(grid, SPRITES.herbL, 60, 24);
  paste(grid, SPRITES.scav, 28, 32);
  paste(grid, SPRITES.pred, 68, 18);

  return grid;
}

const SCENE = buildScene();

export interface PixelSceneProps {
  width?: number;
  className?: string;
}

/** 主菜单像素插画：草地剪影 + 小河 + 小生物（程序化生成，纯 SVG）。 */
export function PixelScene({ width = 480, className }: PixelSceneProps): ReactElement {
  const cells: ReactElement[] = [];
  for (let y = 0; y < SCENE_H; y++) {
    let runStart = -1;
    let runChar = '';
    for (let x = 0; x <= SCENE_W; x++) {
      const c = x < SCENE_W ? SCENE[y][x] : '';
      if (c !== runChar) {
        if (runChar && runStart >= 0) {
          cells.push(
            <rect
              key={`${y}:${runStart}`}
              x={runStart}
              y={y}
              width={x - runStart}
              height={1}
              fill={SCENE_PAL[runChar] ?? SCENE_PAL['1']}
            />,
          );
        }
        runChar = c;
        runStart = x;
      }
    }
  }
  return (
    <svg
      className={className}
      width={width}
      height={(width * SCENE_H) / SCENE_W}
      viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="像素风生态场景插画：草坡、小河与小型生物"
      style={{ display: 'block' }}
    >
      {cells}
    </svg>
  );
}

/** 菜单标题旁的小生物徽标（带轻微浮动动画） */
export function PixelCritter({ size = 40, species = 0 }: { size?: number; species?: number }): ReactElement {
  const name: SpriteName = species === 1 ? 'herbL' : species === 2 ? 'pred' : species === 3 ? 'scav' : 'herbS';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      aria-hidden="true"
      className="critter-bob"
      style={{ display: 'block' }}
    >
      {(() => {
        const sp = SPRITES[name];
        const out: ReactElement[] = [];
        for (let y = 0; y < sp.rows.length; y++) {
          for (let x = 0; x < 12; x++) {
            const color = P[sp.rows[y][x]];
            if (!color) continue;
            out.push(<rect key={`${x}:${y}`} x={x} y={y} width={1} height={1} fill={color} />);
          }
        }
        return out;
      })()}
    </svg>
  );
}

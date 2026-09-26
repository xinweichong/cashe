/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
import { expect, it } from 'vitest';

function luminance(hex: string) {
  const rgb = hex.match(/[a-f\d]{2}/gi)!.map(value => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

it.each(['dark', 'light'])('%s primary and muted text meet normal-text AA on neutral surfaces', theme => {
  const block = theme === 'dark' ? css.split('@theme {')[1].split('}')[0] : css.split(':root[data-theme="light"] {')[1].split('}')[0];
  const token = (name: string) => block.match(new RegExp(`--color-${name}:\\s*(#[a-f\\d]{6})`, 'i'))![1];
  for (const text of ['foreground', 'muted']) {
    for (const surface of ['background', 'card', 'card-elev']) {
      const values = [luminance(token(text)), luminance(token(surface))].sort((a, b) => a - b);
      expect((values[1] + 0.05) / (values[0] + 0.05), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

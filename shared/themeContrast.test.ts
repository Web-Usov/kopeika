import assert from 'node:assert/strict';
import { test } from 'node:test';
import { correctedScreenBg } from './themeContrast.ts';

const theme = (secondary_bg_color: string, section_bg_color: string) => ({
  secondary_bg_color,
  section_bg_color,
  bg_color: section_bg_color,
});

test('iOS: пары проходят без изменений', () => {
  assert.equal(correctedScreenBg(theme('#efeff4', '#ffffff'), 'light'), null);
  assert.equal(correctedScreenBg(theme('#000000', '#1c1c1e'), 'dark'), null);
});

test('Desktop light: #f1f1f1 под #ffffff затемняется', () => {
  assert.equal(correctedScreenBg(theme('#f1f1f1', '#ffffff'), 'light'), '#ebebeb');
  assert.equal(correctedScreenBg(theme('#f4f4f4', '#fff'), 'light'), '#ebebeb');
});

test('поверхность берётся из bg_color, если section_bg_color нет', () => {
  assert.equal(correctedScreenBg({ secondary_bg_color: '#f1f1f1', bg_color: '#ffffff' }, 'light'), '#ebebeb');
});

test('dark: secondary светлее секций — фон темнее секций', () => {
  assert.equal(correctedScreenBg(theme('#232e3c', '#17212b'), 'dark'), '#0e141a');
});

test('dark: почти одинаковые — коррекция', () => {
  assert.equal(correctedScreenBg(theme('#18222d', '#17212b'), 'dark'), '#0e141a');
});

test('неполные и битые параметры — null', () => {
  assert.equal(correctedScreenBg(undefined, 'light'), null);
  assert.equal(correctedScreenBg({}, 'dark'), null);
  assert.equal(correctedScreenBg({ secondary_bg_color: '#f1f1f1' }, 'light'), null);
  assert.equal(correctedScreenBg(theme('red', '#ffffff'), 'light'), null);
  assert.equal(correctedScreenBg(theme('#f1f1f1', '#12345'), 'light'), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {builtinThemes} from '../../src/themes/BuiltinThemes.js';
import {themeCssVariables,validateThemePackage} from '../../src/platform/themes/ThemePackage.js';

test('bundled themes are valid and have unique ids',()=>{
  const themes=builtinThemes.map(validateThemePackage);
  assert.equal(new Set(themes.map(theme=>theme.manifest.id)).size,themes.length);
});

test('Future Glass provides a complete translucent system theme',()=>{
  const light=validateThemePackage(builtinThemes.find(theme=>theme.manifest.id==='glass-light'));
  const glass=validateThemePackage(builtinThemes.find(theme=>theme.manifest.id==='glass'));
  assert.equal(light.manifest.baseMode,'light');
  assert.equal(light.manifest.name.zh,'伏秋玻璃浅色');
  assert.ok(light.tokens.material.transparency<.8);
  assert.equal(glass.manifest.baseMode,'dark');
  assert.equal(glass.manifest.name.zh,'伏秋玻璃深色');
  assert.ok(glass.tokens.material.blur>=20);
  assert.ok(glass.tokens.material.transparency<.8);
  assert.equal(glass.tokens.icons.shape,'squircle');
  assert.match(glass.wallpaper.background,/radial-gradient/);
  assert.match(themeCssVariables(glass)['--theme-surface-alpha'],/^#[0-9a-f]{8}$/i);
});

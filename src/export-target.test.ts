import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  googleFileUrl,
  normalizeExportTarget,
  parseGoogleFileLink,
  sameExportTarget,
  sheetRange,
  sheetTitle,
  storedSheetName,
} from './export-target.ts';

const FILE = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';

describe('parseGoogleFileLink', () => {
  it('reads a spreadsheet link, a document link, and a bare id', () => {
    assert.deepEqual(parseGoogleFileLink(`https://docs.google.com/spreadsheets/d/${FILE}/edit#gid=0`), {
      fileId: FILE,
      kind: 'sheet',
    });
    assert.deepEqual(parseGoogleFileLink(`https://docs.google.com/document/d/${FILE}/edit`), {
      fileId: FILE,
      kind: 'doc',
    });
    assert.deepEqual(parseGoogleFileLink(FILE), { fileId: FILE, kind: null });
  });

  it('rejects a non-https link and a short id', () => {
    assert.equal(parseGoogleFileLink(`http://docs.google.com/spreadsheets/d/${FILE}/edit`), null);
    assert.equal(parseGoogleFileLink('https://example.com/spreadsheets/d/' + FILE), null);
    assert.equal(parseGoogleFileLink(''), null);
    assert.equal(parseGoogleFileLink('short'), null);
  });
});

describe('sheet titles', () => {
  it('turns characters Google rejects into spaces and keeps a blank stored name blank', () => {
    assert.equal(sheetTitle('Day: one/two', 'Revenue'), 'Day one two');
    assert.equal(sheetTitle('', 'Revenue'), 'Revenue');
    assert.equal(sheetTitle('   ', '***'), 'Results');
    assert.equal(storedSheetName(''), '');
    assert.equal(sheetRange("Today's revenue", 'A:ZZ'), "'Today''s revenue'!A:ZZ");
  });
});

describe('normalizeExportTarget', () => {
  it('keeps an empty sheet name empty', () => {
    assert.deepEqual(normalizeExportTarget({ kind: 'sheet', fileId: FILE, sheetName: '' }), {
      kind: 'sheet',
      fileId: FILE,
      sheetName: '',
    });
    assert.equal(normalizeExportTarget({ kind: 'sheet', fileId: 'nope', sheetName: 'Daily' }), null);
    assert.equal(sameExportTarget(null, null), true);
  });
});

describe('googleFileUrl', () => {
  it('opens the matching Google editor', () => {
    assert.equal(googleFileUrl('sheet', FILE), `https://docs.google.com/spreadsheets/d/${FILE}/edit`);
    assert.equal(googleFileUrl('doc', FILE), `https://docs.google.com/document/d/${FILE}/edit`);
  });
});

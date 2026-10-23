import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  filterStorageOptions,
  firstSelectableIndex,
  stepSelectable,
  storageOptionFromDetail,
  storageSuggestionDetail,
  type BigQueryStorageOption,
} from './storages.ts';

const revenue: BigQueryStorageOption = {
  id: 'revenue',
  title: 'Revenue',
  gcpProjectId: 'owox-prod',
  location: 'EU',
};

const ads: BigQueryStorageOption = {
  id: 'ads',
  title: 'Ads (legacy)',
  gcpProjectId: 'owox-ads',
  location: null,
};

const empty: BigQueryStorageOption = {
  id: 'empty',
  title: 'Draft',
  gcpProjectId: null,
  location: 'US',
};

describe('storageOptionFromDetail', () => {
  it('reads the GCP project and location that a storage would fill in', () => {
    const option = storageOptionFromDetail(
      { id: 'revenue', title: ' Revenue ', type: 'GOOGLE_BIGQUERY' },
      { config: { projectId: ' owox-prod ', location: ' EU ' } },
    );
    assert.deepEqual(option, revenue);
    assert.equal(storageSuggestionDetail(option!), 'Project owox-prod · Location EU');
  });

  it('treats autodetect as an empty location and keeps a legacy storage that has a project', () => {
    const option = storageOptionFromDetail(
      { id: 'ads', title: 'Ads', type: 'LEGACY_GOOGLE_BIGQUERY' },
      { config: { projectId: 'owox-ads', location: 'AUTODETECT' } },
    );
    assert.equal(option?.title, 'Ads (legacy)');
    assert.equal(option?.location, null);
    assert.equal(storageSuggestionDetail(option!), 'Project owox-ads · Location autodetect');
  });

  it('drops a storage that is unavailable or has no GCP project', () => {
    assert.equal(
      storageOptionFromDetail(
        { id: 'ads', title: 'Ads', type: 'GOOGLE_BIGQUERY', availableForUse: false },
        { config: { projectId: 'owox-ads', location: 'EU' } },
      ),
      null,
    );
    assert.equal(
      storageOptionFromDetail(
        { id: 'draft', title: 'Draft', type: 'GOOGLE_BIGQUERY' },
        { config: { location: 'US' } },
      ),
      null,
    );
  });

  it('ignores storages that are not BigQuery', () => {
    assert.equal(
      storageOptionFromDetail({ id: 'snow', title: 'Snow', type: 'SNOWFLAKE' }, { config: { projectId: 'x' } }),
      null,
    );
  });
});

describe('filterStorageOptions', () => {
  const options = [revenue, ads, empty];

  it('hides a storage that cannot fill the project', () => {
    assert.deepEqual(
      filterStorageOptions(options, '  ').map(option => option.id),
      ['revenue', 'ads'],
    );
  });

  it('matches the storage name, project, or location', () => {
    assert.deepEqual(
      filterStorageOptions(options, 'eu').map(option => option.id),
      ['revenue'],
    );
    assert.deepEqual(
      filterStorageOptions(options, 'ADS').map(option => option.id),
      ['ads'],
    );
    assert.deepEqual(
      filterStorageOptions(options, 'autodetect').map(option => option.id),
      ['ads'],
    );
  });
});

describe('stepSelectable', () => {
  const options = [empty, revenue, ads];

  it('skips a storage that has no GCP project', () => {
    assert.equal(firstSelectableIndex(options), 1);
    assert.equal(stepSelectable(options, -1, 1), 1);
    assert.equal(stepSelectable(options, 1, 1), 2);
    assert.equal(stepSelectable(options, 2, 1), 2);
    assert.equal(stepSelectable(options, 2, -1), 1);
  });
});

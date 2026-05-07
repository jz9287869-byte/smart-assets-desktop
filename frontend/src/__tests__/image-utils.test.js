import { parseTags } from '../utils/imageUtils';

describe('parseTags', () => {
  test('deduplicates mutually exclusive season and weather tags for display', () => {
    const tags = parseTags({
      tags: '春天,冬天,晴天,阴天,单人,多人,花海',
    });

    expect(tags).toEqual(['春天', '晴天', '单人', '花海']);
  });

  test('removes exact duplicates while preserving ordinary tags', () => {
    const tags = parseTags({
      tags: '花海,花海,春天,春天,晴天',
    });

    expect(tags).toEqual(['花海', '春天', '晴天']);
  });
});

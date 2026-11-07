import { expect, test } from 'vitest';
import { buildChildEnv } from '../../src/gate/childEnv.ts';

test('childEnv drops secrets', () => {
  const env = buildChildEnv({
    ANTHROPIC_API_KEY: 'sk', GITHUB_TOKEN: 'gh', AWS_SECRET_ACCESS_KEY: 'aws', PATH: 'C:/bin', USERPROFILE: 'C:/Users/me',
  });
  expect(env).toEqual({ PATH: 'C:/bin', USERPROFILE: 'C:/Users/me' });
});

test('childEnv keeps Windows-cased keys', () => {
  expect(buildChildEnv({ Path: 'x', SystemRoot: 'C:/Windows', SMTP_PASSWORD: 'p' })).toEqual({ Path: 'x', SystemRoot: 'C:/Windows' });
});

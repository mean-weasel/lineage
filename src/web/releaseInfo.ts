declare const __LINEAGE_VERSION__: string;
declare const __LINEAGE_RELEASE_CHANNEL__: string;

export const lineageReleaseInfo = {
  channel: typeof __LINEAGE_RELEASE_CHANNEL__ === 'undefined' ? 'test' : __LINEAGE_RELEASE_CHANNEL__,
  version: typeof __LINEAGE_VERSION__ === 'undefined' ? '0.0.0' : __LINEAGE_VERSION__,
};

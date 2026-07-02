import type {
  AssetCatalog,
  AssetLibrarySnapshot,
  AssetContentType,
  GrowthAsset,
  LiveS3Object,
  MutationResponse,
  PresignResponse,
  UploadFields,
} from '../../../shared/types';

interface StorageCommandResult {
  stdout: string;
  stderr: string;
}

export interface StorageAdapter {
  deleteObjectGuarded(project: string, assetId: string, confirmation: string): MutationResponse;
  getIdentity(): AssetLibrarySnapshot['identity'] | undefined;
  listLiveObjects(catalog: AssetCatalog): LiveS3Object[];
  presignAsset(project: string, assetId: string, expiresIn?: number): PresignResponse;
  promoteAsset(project: string, assetId: string, confirmWrite: boolean): MutationResponse;
  pullAsset(project: string, assetId: string, out?: string): MutationResponse;
  uploadAsset(file: string, fields: UploadFields): MutationResponse;
}

export interface StorageAdapterDependencies {
  assetById(catalog: AssetCatalog, assetId: string): GrowthAsset;
  cleanProject(project?: string): string;
  createError(message: string, status?: number): Error;
  defaultProject: string;
  loadCatalog(project?: string): AssetCatalog;
  runAssetScript(command: string, args: string[]): StorageCommandResult;
  runAws(args: string[]): StorageCommandResult;
  saveCatalog(project: string, catalog: AssetCatalog): AssetCatalog;
  supportedContentTypes: ReadonlySet<AssetContentType>;
}

import db from '@/lib/db';
import { syncStatus, validateSyncFolder } from '@/lib/sync';

// Sync status: device identity, folder, peers, last export.
export async function GET() {
  try {
    return Response.json(syncStatus());
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// Configure (or clear) the shared sync folder.
export async function PUT(request) {
  try {
    const { sync_folder } = await request.json();
    if (!sync_folder || !String(sync_folder).trim()) {
      db.patchDeviceConfig({ sync_folder: null });
      return Response.json(syncStatus());
    }
    const problem = validateSyncFolder(sync_folder);
    if (problem) return Response.json({ error: problem }, { status: 400 });
    db.patchDeviceConfig({ sync_folder: String(sync_folder).trim() });
    return Response.json(syncStatus());
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

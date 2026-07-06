import db from '@/lib/db';
import pkg from '../../../../package.json';

// This installation's identity — a generated device id plus a friendly label
// ("Jelou's laptop"). Not an account: no password, nothing to log into.
// Also carries app info for the Settings page (version, data location).
export async function GET() {
  try {
    return Response.json({
      device_id: db.getDeviceId(),
      device_label: db.getDeviceLabel(),
      version: pkg.version,
      data_dir: db.paths.dataDir,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const { device_label } = await request.json();
    if (!device_label || !String(device_label).trim()) {
      return Response.json({ error: 'A name is required' }, { status: 400 });
    }
    const saved = db.setDeviceLabel(device_label);
    return Response.json({ device_id: db.getDeviceId(), device_label: saved });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

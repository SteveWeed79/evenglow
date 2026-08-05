/**
 * `pnpm db:usage` — what each farm is costing, in bytes.
 *
 * **Not for pricing.** `ACCESS-AND-BILLING.md` §4.1 settles that: the costs are
 * fixed rather than marginal, a farm is under a dime a year to serve, and the
 * price is $39 because that is what a smallholder will pay. The two numbers are
 * three orders of magnitude apart, and a per-farm cost figure is not an input
 * to a decision anybody is going to make.
 *
 * It is for the three things §4.1c names:
 *
 * 1. **Capacity.** The Oracle Always Free box has 200 GB. Knowing how much of
 *    it is gone, and how fast, is the difference between planning a move and
 *    discovering one.
 * 2. **The outlier who uploads video.** A photo compressed for the purpose is
 *    200–400 KB. A farm whose photo bytes are two orders of magnitude past
 *    that is doing something the resize path did not catch, and it will be one
 *    farm rather than a trend.
 * 3. **When photo bytes should leave the database for S3** (§4A). The move is
 *    decided, not open; this is what says when.
 *
 * Read-only, and safe to run against the live database — every operation here
 * is a count, a `$bsonSize` sum, or a GridFS file listing.
 *
 * ## Records and bytes are counted separately, and that is the point
 *
 * A busy year of records is 884 KB (§"deliberately not on this list" in the
 * roadmap). One phone photo is three to five times a decade of them. Adding
 * the two into a single "storage" figure would hide the only ratio worth
 * looking at — which of the two is actually growing.
 */
import { MongoClient } from 'mongodb';
import { COLLECTIONS } from './scoped.ts';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Set MONGODB_URI. Example:\n  MONGODB_URI=mongodb://localhost:27017 pnpm db:usage');
  process.exit(1);
}

const dbName = process.env.MONGODB_DB ?? 'steading';

/** Bytes, in the units somebody reading a capacity report thinks in. */
function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const client = await new MongoClient(uri).connect();

try {
  const db = client.db(dbName);

  const orgs = await db
    .collection<{ _id: string; name: string; createdAt: Date }>('orgs')
    .find({})
    .sort({ createdAt: 1 })
    .toArray();

  if (orgs.length === 0) {
    console.log(`No farms in ${dbName}.`);
    process.exit(0);
  }

  interface Row {
    id: string;
    name: string;
    members: number;
    records: number;
    recordBytes: number;
    photos: number;
    photoBytes: number;
    /** Photo bytes uploaded in the last 30 days — the transfer proxy. See below. */
    recentPhotoBytes: number;
  }

  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows: Row[] = [];

  for (const org of orgs) {
    let records = 0;
    let recordBytes = 0;

    for (const name of COLLECTIONS) {
      /**
       * `$bsonSize` over the org's own documents, rather than `collStats`.
       *
       * `collStats` reports a whole collection, and every collection here
       * holds every farm — so it would answer a question nobody asked. This
       * is the only way to get a per-tenant figure out of a shared collection,
       * and it is a full scan of that tenant's documents, which is why this is
       * an operator script rather than anything on a request path.
       */
      const [summed] = await db
        .collection(name)
        .aggregate([
          { $match: { orgId: org._id } },
          { $group: { _id: null, n: { $sum: 1 }, bytes: { $sum: { $bsonSize: '$$ROOT' } } } },
        ])
        .toArray();

      records += (summed?.n as number | undefined) ?? 0;
      recordBytes += (summed?.bytes as number | undefined) ?? 0;
    }

    // GridFS keeps the length on the files document, so the bytes are read
    // without touching a chunk.
    const files = await db
      .collection<{ length: number; uploadDate: Date }>('photoBytes.files')
      .find({ 'metadata.orgId': org._id })
      .project<{ length: number; uploadDate: Date }>({ length: 1, uploadDate: 1 })
      .toArray();

    rows.push({
      id: org._id,
      name: org.name,
      members: await db.collection('users').countDocuments({ orgId: org._id }),
      records,
      recordBytes,
      photos: files.length,
      photoBytes: files.reduce((sum, file) => sum + file.length, 0),
      /**
       * A proxy for transfer, and labelled as one.
       *
       * Real bandwidth accounting would mean counting bytes on every request,
       * which is a cost on the hot path to answer a question that is asked
       * once a quarter. Photo bytes dominate everything else this app sends by
       * two orders of magnitude — a mutation batch is kilobytes — so recent
       * uploads are the number that would actually move an egress bill, and
       * uploads are downloaded again by every other device on the farm.
       */
      recentPhotoBytes: files
        .filter((file) => file.uploadDate >= since)
        .reduce((sum, file) => sum + file.length, 0),
    });
  }

  rows.sort((a, b) => b.recordBytes + b.photoBytes - (a.recordBytes + a.photoBytes));

  console.log(`\n  ${dbName} — ${rows.length} farm${rows.length === 1 ? '' : 's'}\n`);

  for (const row of rows) {
    const total = row.recordBytes + row.photoBytes;
    console.log(`  ${row.name}  (${row.id})`);
    console.log(
      `    ${row.members} member${row.members === 1 ? '' : 's'} · ` +
        `${row.records} records, ${human(row.recordBytes)} · ` +
        `${row.photos} photos, ${human(row.photoBytes)} · ` +
        `${human(total)} total`,
    );

    /**
     * The outlier check, said as a sentence rather than left in the numbers.
     *
     * A resized photo is 200–400 KB. A mean well past that means something
     * escaped the resize path on the way out of a phone — which is the case
     * §4.1c is actually looking for, and it is one farm rather than a trend.
     */
    if (row.photos > 0) {
      const mean = row.photoBytes / row.photos;
      if (mean > 2_000_000) {
        console.log(
          `    ⚠ mean photo is ${human(mean)} — the resize path targets 200–400 KB.`,
        );
      }
    }

    if (row.recentPhotoBytes > 0) {
      console.log(`    ${human(row.recentPhotoBytes)} of photos uploaded in the last 30 days.`);
    }
    console.log('');
  }

  const records = rows.reduce((sum, row) => sum + row.recordBytes, 0);
  const photos = rows.reduce((sum, row) => sum + row.photoBytes, 0);

  console.log(`  Records: ${human(records)}   Photos: ${human(photos)}   All: ${human(records + photos)}`);

  /**
   * The one threshold this script exists to watch, from §4A.3.
   *
   * The move to S3 is decided rather than open — what was missing was the
   * signal for when. Photo bytes in the database are what make a `mongodump`
   * large, and the dump is what has to fit on the box and cross a wire every
   * night. Ten gigabytes is where a nightly backup stops being free in
   * anybody's terms.
   */
  if (photos > 10 * 1024 ** 3) {
    console.log(
      `\n  ⚠ Photo bytes are past 10 GB. That is the signal in ACCESS-AND-BILLING §4A.3:\n` +
        `    move the bytes to S3 before the nightly dump becomes the problem.`,
    );
  }

  console.log('');
} finally {
  await client.close();
}

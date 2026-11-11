import 'dart:convert';

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import 'models.dart';

/// Offline storage: a catalogue cache and an outbox of bills waiting to sync.
/// (The plan names Drift; plain sqflite is used here to avoid code generation in the first cut.)
class LocalDb {
  LocalDb._(this._db);
  final Database _db;

  static Future<LocalDb> open() async {
    final db = await openDatabase(
      p.join(await getDatabasesPath(), 'dukaanos.db'),
      version: 1,
      onCreate: (db, _) async {
        await db.execute('''
          create table products (
            id text primary key, store_id text not null, name text not null,
            barcode text, unit text not null, sell_paise integer not null,
            gst_rate integer not null)''');
        await db.execute('create index products_barcode on products (barcode)');
        await db.execute('''
          create table outbox (
            id text primary key,          -- the bill UUID: the server dedupes on it
            payload text not null,
            created_at integer not null,
            attempts integer not null default 0,
            status text not null default 'pending',  -- pending | failed
            last_error text)''');
      },
    );
    return LocalDb._(db);
  }

  Future<void> replaceCatalogue(String storeId, List<Product> products) async {
    await _db.transaction((txn) async {
      await txn.delete('products', where: 'store_id = ?', whereArgs: [storeId]);
      final batch = txn.batch();
      for (final prod in products) {
        batch.insert('products', prod.toRow());
      }
      await batch.commit(noResult: true);
    });
  }

  Future<List<Product>> search(String storeId, String query) async {
    final q = query.trim();
    final rows = await _db.query(
      'products',
      where: q.isEmpty ? 'store_id = ?' : 'store_id = ? and (name like ? or barcode = ?)',
      whereArgs: q.isEmpty ? [storeId] : [storeId, '%$q%', q],
      orderBy: 'name collate nocase',
      limit: 50,
    );
    return rows.map(Product.fromRow).toList();
  }

  Future<Product?> byBarcode(String storeId, String barcode) async {
    final rows = await _db.query('products',
        where: 'store_id = ? and barcode = ?', whereArgs: [storeId, barcode], limit: 1);
    return rows.isEmpty ? null : Product.fromRow(rows.first);
  }

  Future<Product?> byId(String id) async {
    final rows = await _db.query('products', where: 'id = ?', whereArgs: [id], limit: 1);
    return rows.isEmpty ? null : Product.fromRow(rows.first);
  }

  Future<void> enqueueBill(String id, Map<String, Object?> payload) async {
    await _db.insert(
      'outbox',
      {'id': id, 'payload': jsonEncode(payload), 'created_at': DateTime.now().millisecondsSinceEpoch},
      conflictAlgorithm: ConflictAlgorithm.ignore, // same UUID twice is a no-op
    );
  }

  Future<List<Map<String, Object?>>> pendingBills() =>
      _db.query('outbox', where: "status = 'pending'", orderBy: 'created_at');

  Future<int> pendingCount() async => Sqflite.firstIntValue(
          await _db.rawQuery("select count(*) from outbox where status = 'pending'")) ??
      0;

  Future<int> failedCount() async => Sqflite.firstIntValue(
          await _db.rawQuery("select count(*) from outbox where status = 'failed'")) ??
      0;

  Future<void> markSynced(String id) => _db.delete('outbox', where: 'id = ?', whereArgs: [id]);

  Future<void> markFailed(String id, String error) => _db.update(
      'outbox', {'status': 'failed', 'last_error': error},
      where: 'id = ?', whereArgs: [id]);

  Future<void> bumpAttempts(String id) =>
      _db.rawUpdate('update outbox set attempts = attempts + 1 where id = ?', [id]);
}

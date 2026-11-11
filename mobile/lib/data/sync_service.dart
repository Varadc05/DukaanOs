import 'dart:convert';

import 'package:supabase_flutter/supabase_flutter.dart';

import 'api.dart';
import 'local_db.dart';
import 'models.dart';

class SyncService {
  SyncService(this.db, this.api);
  final LocalDb db;
  final Api api;
  bool _busy = false;

  /// Pull the catalogue into SQLite. RLS makes sure a member only gets their own store.
  Future<void> pullCatalogue(String storeId) async {
    final rows = await Supabase.instance.client
        .from('products')
        .select('id,store_id,name,barcode,unit,sell_paise,gst_rate')
        .eq('store_id', storeId)
        .eq('active', true);
    await db.replaceCatalogue(storeId, rows.map(Product.fromSupabase).toList());
  }

  /// Upload queued bills in order. Network trouble stops the run and leaves bills queued
  /// for the next attempt; a business rejection (4xx) parks that bill as failed so one bad
  /// bill never blocks the others. Returns how many bills synced.
  Future<int> pushOutbox() async {
    if (_busy) return 0;
    _busy = true;
    var synced = 0;
    try {
      for (final row in await db.pendingBills()) {
        final id = row['id'] as String;
        try {
          await api.postBill(jsonDecode(row['payload'] as String) as Map<String, dynamic>);
          await db.markSynced(id);
          synced++;
        } on ApiException catch (e) {
          if (e.status >= 400 && e.status < 500 && e.status != 401 && e.status != 429) {
            await db.markFailed(id, e.toString());
          } else {
            await db.bumpAttempts(id);
            break; // 401 (signed out), 429, 5xx: try again later
          }
        } catch (_) {
          await db.bumpAttempts(id);
          break; // offline or timeout
        }
      }
    } finally {
      _busy = false;
    }
    return synced;
  }
}

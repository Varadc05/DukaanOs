import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/money.dart';
import '../../core/theme.dart';
import '../../data/api.dart';
import 'adjust_stock_screen.dart';
import 'product_form_screen.dart';
import 'receive_stock_screen.dart';

/// Every product with stock on hand. Anyone in the store can look; only the owner can change things.
class ProductsScreen extends StatefulWidget {
  const ProductsScreen({super.key, required this.storeId});
  final String storeId;
  @override
  State<ProductsScreen> createState() => _ProductsScreenState();
}

class _ProductsScreenState extends State<ProductsScreen> {
  late Future<List<Map<String, dynamic>>> _future = _load();
  String _query = '';
  bool _isOwner = false;

  @override
  void initState() {
    super.initState();
    _loadRole();
  }

  Future<void> _loadRole() async {
    try {
      final client = Supabase.instance.client;
      final row = await client
          .from('members')
          .select('role')
          .eq('store_id', widget.storeId)
          .eq('user_id', client.auth.currentUser!.id)
          .maybeSingle();
      if (mounted) setState(() => _isOwner = row?['role'] == 'owner');
    } catch (_) {
      // Stay read-only; the backend enforces the owner rule anyway.
    }
  }

  Future<List<Map<String, dynamic>>> _load() async {
    final body = await context.read<Api>().getJson('/v1/stores/${widget.storeId}/products');
    return (body['products'] as List).cast<Map<String, dynamic>>();
  }

  void _refresh() => setState(() => _future = _load());

  Future<void> _open(Widget screen) async {
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => screen));
    if (changed == true) _refresh();
  }

  void _actions(Map<String, dynamic> p) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(p['name'] as String, style: Theme.of(ctx).textTheme.titleLarge),
            ),
          ),
          ListTile(
            leading: const Icon(Icons.add_box_outlined),
            title: const Text('Add stock (goods arrived)'),
            onTap: () {
              Navigator.pop(ctx);
              _open(ReceiveStockScreen(storeId: widget.storeId, product: p));
            },
          ),
          ListTile(
            leading: const Icon(Icons.fact_check_outlined),
            title: const Text('Count stock on the shelf'),
            onTap: () {
              Navigator.pop(ctx);
              _open(AdjustStockScreen(storeId: widget.storeId, product: p));
            },
          ),
          ListTile(
            leading: const Icon(Icons.edit_outlined),
            title: const Text('Edit product'),
            onTap: () {
              Navigator.pop(ctx);
              _open(ProductFormScreen(storeId: widget.storeId, product: p));
            },
          ),
        ]),
      ),
    );
  }

  bool _matches(Map<String, dynamic> p) {
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return true;
    return (p['name'] as String).toLowerCase().contains(q) ||
        ((p['barcode'] as String?) ?? '').contains(q) ||
        (p['aliases'] as List).any((a) => (a as String).toLowerCase().contains(q));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Products')),
      floatingActionButton: _isOwner
          ? FloatingActionButton.extended(
              onPressed: () => _open(ProductFormScreen(storeId: widget.storeId)),
              backgroundColor: Palette.turmeric,
              foregroundColor: Palette.ink,
              icon: const Icon(Icons.add),
              label: const Text('Add product'),
            )
          : null,
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: TextField(
            decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search name, barcode or nickname'),
            onChanged: (v) => setState(() => _query = v),
          ),
        ),
        Expanded(
          child: FutureBuilder<List<Map<String, dynamic>>>(
            future: _future,
            builder: (context, snap) {
              if (snap.connectionState != ConnectionState.done) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snap.hasError) {
                return Center(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    const Text('Could not load products. Check your connection.'),
                    TextButton(onPressed: _refresh, child: const Text('Try again')),
                  ]),
                );
              }
              final items = snap.data!.where(_matches).toList();
              if (items.isEmpty) {
                return Center(child: Text(_query.isEmpty ? 'No products yet. Tap Add product.' : 'Nothing matches "$_query".'));
              }
              return RefreshIndicator(
                onRefresh: () async => _refresh(),
                child: ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 96),
                  itemCount: items.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                  itemBuilder: (context, i) {
                    final p = items[i];
                    final qty = p['qty_milli'] as int;
                    final out = qty <= 0;
                    return SoftCard(
                      padding: EdgeInsets.zero,
                      child: ListTile(
                        minVerticalPadding: 10,
                        title: Text(p['name'] as String, style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text('${formatRupees(p['sell_paise'] as int)} / ${p['unit']}'),
                        trailing: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: out ? Palette.redTint : Palette.greenTint,
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            out ? 'Out of stock' : formatQty(qty, p['unit'] as String),
                            style: TextStyle(fontWeight: FontWeight.w700, color: out ? Palette.red : Palette.green),
                          ),
                        ),
                        onTap: _isOwner ? () => _actions(p) : null,
                      ),
                    );
                  },
                ),
              );
            },
          ),
        ),
      ]),
    );
  }
}

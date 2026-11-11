import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:speech_to_text/speech_to_text.dart';

import '../../core/money.dart';
import '../../data/api.dart';
import '../../data/local_db.dart';
import '../../data/models.dart';
import '../../data/sync_service.dart';
import '../dashboard/dashboard_screen.dart';
import '../insights/insights_screen.dart';
import 'cart_model.dart';
import 'scanner_page.dart';

class BillingScreen extends StatefulWidget {
  const BillingScreen({super.key, required this.storeId});
  final String storeId;
  @override
  State<BillingScreen> createState() => _BillingScreenState();
}

class _BillingScreenState extends State<BillingScreen> {
  final _search = TextEditingController();
  final _speech = SpeechToText();
  List<Product> _results = [];
  bool _listening = false;
  int _pending = 0;
  int _failed = 0;

  LocalDb get _db => context.read<LocalDb>();

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    final sync = context.read<SyncService>();
    try {
      await sync.pullCatalogue(widget.storeId); // offline: falls back to the cached catalogue
    } catch (_) {}
    await sync.pushOutbox();
    await _refresh();
  }

  Future<void> _refresh() async {
    final results = await _db.search(widget.storeId, _search.text);
    final pending = await _db.pendingCount();
    final failed = await _db.failedCount();
    if (mounted) setState(() {
      _results = results;
      _pending = pending;
      _failed = failed;
    });
  }

  void _toast(String msg) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));

  Future<void> _scan() async {
    final code = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const ScannerPage()));
    if (code == null || !mounted) return;
    final product = await _db.byBarcode(widget.storeId, code);
    if (!mounted) return;
    if (product == null) {
      _toast('Barcode $code is not in the catalogue yet');
    } else {
      context.read<CartModel>().add(product);
    }
  }

  /// Push to talk. Speech is recognised on the phone; the text goes to our backend, which
  /// returns SUGGESTED lines. Anything uncertain is shown for the cashier to confirm.
  Future<void> _voice() async {
    if (_listening) {
      await _speech.stop();
      return;
    }
    final ok = await _speech.initialize(onError: (_) => setState(() => _listening = false));
    if (!ok) {
      _toast('Voice is not available on this phone');
      return;
    }
    setState(() => _listening = true);
    await _speech.listen(
      listenFor: const Duration(seconds: 10),
      onResult: (r) async {
        if (!r.finalResult) return;
        setState(() => _listening = false);
        await _handleSpeech(r.recognizedWords);
      },
    );
  }

  Future<void> _handleSpeech(String text) async {
    if (text.trim().isEmpty) return;
    try {
      final suggestions = await context.read<Api>().parseVoice(widget.storeId, text);
      if (!mounted) return;
      for (final s in suggestions) {
        final candidates = (s['candidates'] as List).cast<Map<String, dynamic>>();
        if (candidates.isEmpty) {
          _toast('Could not find "${s['heard']}"');
          continue;
        }
        final qty = (s['qty_milli'] as num?)?.toInt() ?? 1000;
        Map<String, dynamic>? chosen =
            s['decision'] == 'auto' ? candidates.first : await _pick(s['heard'] as String, candidates);
        if (chosen == null || !mounted) continue;
        final product = await _db.byId(chosen['productId'] as String);
        if (product != null && mounted) context.read<CartModel>().add(product, qtyMilli: qty);
      }
    } on ApiException catch (e) {
      _toast('Voice failed: ${e.message}');
    } catch (_) {
      _toast('Voice needs internet. Use scan or search offline.');
    }
  }

  Future<Map<String, dynamic>?> _pick(String heard, List<Map<String, dynamic>> candidates) {
    return showDialog<Map<String, dynamic>>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: Text('Which one: "$heard"?'),
        children: [
          for (final c in candidates)
            SimpleDialogOption(onPressed: () => Navigator.pop(ctx, c), child: Text('${c['name']}')),
          SimpleDialogOption(onPressed: () => Navigator.pop(ctx), child: const Text('Skip')),
        ],
      ),
    );
  }

  Future<void> _pay(String mode) async {
    final cart = context.read<CartModel>();
    if (cart.isEmpty) return;
    await cart.checkout(paymentMode: mode);
    await _refresh();
    _toast('Bill saved${_pending > 0 ? ' (will sync when online)' : ''}');
  }

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartModel>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('DukaanOS'),
        actions: [
          IconButton(
            icon: const Icon(Icons.bar_chart),
            tooltip: 'Sales',
            onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => DashboardScreen(storeId: widget.storeId))),
          ),
          IconButton(
            icon: const Icon(Icons.lightbulb_outline),
            tooltip: 'Stock insights',
            onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => InsightsScreen(storeId: widget.storeId))),
          ),
          if (_pending > 0)
            Padding(padding: const EdgeInsets.all(12), child: Chip(label: Text('$_pending to sync'))),
          if (_failed > 0)
            Padding(padding: const EdgeInsets.all(12), child: Chip(label: Text('$_failed need attention'))),
        ],
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.all(8),
          child: Row(children: [
            Expanded(
              child: TextField(
                controller: _search,
                decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search products'),
                onChanged: (_) => _refresh(),
              ),
            ),
            IconButton(icon: const Icon(Icons.qr_code_scanner), tooltip: 'Scan', onPressed: _scan),
            IconButton(
              icon: Icon(_listening ? Icons.stop_circle : Icons.mic),
              tooltip: 'Voice',
              color: _listening ? Colors.red : null,
              onPressed: _voice,
            ),
          ]),
        ),
        Expanded(
          child: ListView(children: [
            for (final p in _results)
              ListTile(
                title: Text(p.name),
                subtitle: Text('${formatRupees(p.sellPaise)} / ${p.unit}'),
                trailing: const Icon(Icons.add_circle_outline),
                onTap: () => cart.add(p),
              ),
          ]),
        ),
        const Divider(height: 1),
        SizedBox(
          height: 180,
          child: cart.isEmpty
              ? const Center(child: Text('Cart is empty'))
              : ListView(children: [
                  for (final l in cart.lines)
                    ListTile(
                      dense: true,
                      title: Text(l.product.name),
                      subtitle: Text(formatQty(l.qtyMilli, l.product.unit)),
                      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                        IconButton(
                            icon: const Icon(Icons.remove),
                            onPressed: () => cart.setQty(l.product.id, l.qtyMilli - 1000)),
                        IconButton(
                            icon: const Icon(Icons.add),
                            onPressed: () => cart.setQty(l.product.id, l.qtyMilli + 1000)),
                      ]),
                    ),
                ]),
        ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(8),
            child: Row(children: [
              Expanded(child: Text('Total ${formatRupees(cart.subtotalPaise)}', style: Theme.of(context).textTheme.titleMedium)),
              FilledButton(onPressed: cart.isEmpty ? null : () => _pay('cash'), child: const Text('Cash')),
              const SizedBox(width: 8),
              FilledButton.tonal(onPressed: cart.isEmpty ? null : () => _pay('upi'), child: const Text('UPI')),
            ]),
          ),
        ),
      ]),
    );
  }
}

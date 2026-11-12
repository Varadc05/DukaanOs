import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/money.dart';
import '../../core/theme.dart';
import '../../data/api.dart';

class _Bucket {
  const _Bucket(this.key, this.label, this.color, this.hint);
  final String key;
  final String label;
  final Color color;
  final String hint;
}

// Order matters: worst first. Every rupee of stock is in exactly one of these.
const _buckets = [
  _Bucket('expired', 'Expired', Palette.red, 'Write off'),
  _Bucket('expiring_soon', 'Expiring soon', Palette.turmeric, 'Sell fast or return'),
  _Bucket('dead', 'Not selling', Color(0xFF7A5200), 'No sale for 60+ days'),
  _Bucket('slow', 'Selling slowly', Color(0xFFF2D58A), 'More stock than you need'),
  _Bucket('healthy', 'Selling well', Palette.green, 'Keep stocked'),
];

/// Owner-only: where the cash in stock is sitting, and whether you can afford today's reorder.
class WorkingCapitalScreen extends StatefulWidget {
  const WorkingCapitalScreen({super.key, required this.storeId});
  final String storeId;
  @override
  State<WorkingCapitalScreen> createState() => _WorkingCapitalScreenState();
}

class _WorkingCapitalScreenState extends State<WorkingCapitalScreen> {
  final _cash = TextEditingController();
  late Future<Map<String, dynamic>> _future = _load();

  @override
  void dispose() {
    _cash.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>> _load() {
    final paise = parseRupeesToPaise(_cash.text);
    final query = paise == null ? '' : '?budget_paise=$paise';
    return context.read<Api>().getJson('/v1/stores/${widget.storeId}/working-capital$query');
  }

  void _apply() {
    FocusScope.of(context).unfocus();
    setState(() => _future = _load());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Cash in stock')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          final err = snap.error;
          if (err is ApiException && err.code == 'owner_only') {
            return const Center(child: Text('Only the owner can see this.'));
          }
          if (snap.hasError) {
            return Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                const Text('Could not load. Check your connection.'),
                TextButton(onPressed: _apply, child: const Text('Try again')),
              ]),
            );
          }
          final d = snap.data!;
          final total = d['total_paise'] as int;
          final amounts = (d['buckets_paise'] as Map).cast<String, int>();
          final lines = (d['lines'] as List).cast<Map<String, dynamic>>();
          final budget = d['budget_paise'] as int?;
          final headroom = d['headroom_paise'] as int?;
          final needed = d['reorder_needed_paise'] as int;
          return ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(color: Palette.green, borderRadius: BorderRadius.circular(18)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Cash tied up in stock', style: TextStyle(color: Colors.white70, fontSize: 15, fontWeight: FontWeight.w600)),
                Text(formatRupees(total), style: const TextStyle(color: Colors.white, fontSize: 40, fontWeight: FontWeight.w800)),
                Text('At what you paid, not selling price', style: TextStyle(color: Colors.white.withOpacity(0.8))),
              ]),
            ),
            const SizedBox(height: 14),
            if (total == 0)
              const SoftCard(child: Text('No stock cost recorded yet. Add stock with the price you paid and this will fill in.'))
            else
              SoftCard(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(999),
                    child: SizedBox(
                      height: 16,
                      child: Row(children: [
                        for (final b in _buckets)
                          if ((amounts[b.key] ?? 0) > 0)
                            Expanded(flex: amounts[b.key]!, child: Container(color: b.color)),
                      ]),
                    ),
                  ),
                  const SizedBox(height: 12),
                  for (final b in _buckets)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(children: [
                        Container(width: 14, height: 14, decoration: BoxDecoration(color: b.color, borderRadius: BorderRadius.circular(4))),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(b.label, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                            Text(b.hint, style: const TextStyle(color: Palette.muted, fontSize: 13)),
                          ]),
                        ),
                        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                          Text(formatRupees(amounts[b.key] ?? 0), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                          Text('${((amounts[b.key] ?? 0) * 100 / total).round()}%', style: const TextStyle(color: Palette.muted, fontSize: 13)),
                        ]),
                      ]),
                    ),
                ]),
              ),
            const SizedBox(height: 14),
            SoftCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Could be turned back into cash', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 4),
                Text(formatRupees(d['freeable_paise'] as int),
                    style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: Palette.green)),
                const Text('Expiring, not-selling and slow stock, at cost. Discount it or return it to the supplier.',
                    style: TextStyle(color: Palette.muted, fontSize: 13)),
              ]),
            ),
            const SizedBox(height: 14),
            SoftCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Can you afford today\'s order?', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 4),
                Text('Suggested order costs about ${formatRupees(needed)}.', style: const TextStyle(color: Palette.muted)),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(
                    child: TextField(
                      controller: _cash,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(labelText: 'Cash you can spend ₹'),
                      onSubmitted: (_) => _apply(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  TextButton(onPressed: _apply, child: const Text('Check')),
                ]),
                if (budget != null && headroom != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(
                      headroom >= 0
                          ? 'Yes. ${formatRupees(headroom)} will be left over.'
                          : 'Short by ${formatRupees(-headroom)}. Order the most urgent items first.',
                      style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: headroom >= 0 ? Palette.green : Palette.red),
                    ),
                  ),
              ]),
            ),
            if (lines.isNotEmpty) ...[
              Padding(
                padding: const EdgeInsets.only(top: 20, bottom: 8),
                child: Text('Needs your attention', style: Theme.of(context).textTheme.titleMedium),
              ),
              SoftCard(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Column(children: [
                  for (var i = 0; i < lines.length; i++)
                    _line(lines[i], first: i == 0),
                ]),
              ),
            ],
          ]);
        },
      ),
    );
  }

  Widget _line(Map<String, dynamic> l, {required bool first}) {
    final b = _buckets.firstWhere((x) => x.key == l['bucket']);
    return Container(
      decoration: BoxDecoration(border: first ? null : const Border(top: BorderSide(color: Color(0xFFEFE7D5)))),
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(children: [
        Container(width: 10, height: 10, decoration: BoxDecoration(color: b.color, shape: BoxShape.circle)),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(l['name'] as String, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
            Text('${b.label}: ${l['note']}', style: const TextStyle(color: Palette.muted, fontSize: 13)),
          ]),
        ),
        Text(formatRupees(l['value_paise'] as int), style: const TextStyle(fontWeight: FontWeight.w700)),
      ]),
    );
  }
}

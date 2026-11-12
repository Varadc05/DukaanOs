import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

class ApiException implements Exception {
  ApiException(this.status, this.code, this.message);
  final int status;
  final String code;
  final String message;
  @override
  String toString() => '$code: $message';
}

/// Talks only to OUR backend. No AI keys or service keys exist in the app.
class Api {
  Api(this.baseUrl);
  final String baseUrl;

  Map<String, String> get _headers {
    final token = Supabase.instance.client.auth.currentSession?.accessToken;
    return {
      'content-type': 'application/json',
      if (token != null) 'authorization': 'Bearer $token',
    };
  }

  /// Sends a bill. Safe to retry: the backend dedupes on the bill id.
  Future<void> postBill(Map<String, dynamic> bill) async {
    final res = await http
        .post(Uri.parse('$baseUrl/v1/bills'), headers: _headers, body: jsonEncode(bill))
        .timeout(const Duration(seconds: 15));
    if (res.statusCode == 200 || res.statusCode == 201) return;
    final body = _tryJson(res.body);
    throw ApiException(res.statusCode, '${body['error'] ?? 'error'}', '${body['message'] ?? res.body}');
  }

  /// Turns transcribed speech into suggested cart lines. Suggestions only.
  Future<List<Map<String, dynamic>>> parseVoice(String storeId, String text) async {
    final res = await http
        .post(Uri.parse('$baseUrl/v1/voice/parse'),
            headers: _headers, body: jsonEncode({'store_id': storeId, 'text': text}))
        .timeout(const Duration(seconds: 12));
    if (res.statusCode != 200) {
      final body = _tryJson(res.body);
      throw ApiException(res.statusCode, '${body['error'] ?? 'error'}', '${body['message'] ?? res.body}');
    }
    final body = _tryJson(res.body);
    return (body['suggestions'] as List).cast<Map<String, dynamic>>();
  }

  /// Dashboard numbers (any member) or insights (owner only), straight from the backend.
  Future<Map<String, dynamic>> getJson(String path) async {
    final res = await http
        .get(Uri.parse('$baseUrl$path'), headers: _headers)
        .timeout(const Duration(seconds: 15));
    final body = _tryJson(res.body);
    if (res.statusCode != 200) {
      throw ApiException(res.statusCode, '${body['error'] ?? 'error'}', '${body['message'] ?? res.body}');
    }
    return body;
  }

  /// POST or PATCH JSON to our backend. Throws [ApiException] on any non-2xx answer.
  Future<Map<String, dynamic>> sendJson(String method, String path, Map<String, dynamic> body) async {
    final req = http.Request(method, Uri.parse('$baseUrl$path'))
      ..headers.addAll(_headers)
      ..body = jsonEncode(body);
    final res = await http.Response.fromStream(await req.send().timeout(const Duration(seconds: 15)));
    final json = _tryJson(res.body);
    if (res.statusCode < 200 || res.statusCode > 299) {
      throw ApiException(res.statusCode, '${json['error'] ?? 'error'}', '${json['message'] ?? res.body}');
    }
    return json;
  }

  Map<String, dynamic> _tryJson(String s) {
    try {
      return jsonDecode(s) as Map<String, dynamic>;
    } catch (_) {
      return {};
    }
  }
}

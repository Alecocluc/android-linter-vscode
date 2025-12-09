package com.androidlinter.server.protocol

import kotlinx.serialization.Serializable

/**
 * Data transfer objects for the JSON-RPC protocol
 */

@Serializable
data class LintQuickFixDto(
    val description: String,
    val replacementText: String? = null
)

@Serializable
data class LintIssueDto(
    val id: String,
    val severity: String,
    val message: String,
    val file: String,
    val line: Int,
    val column: Int,
    val endLine: Int = line,
    val endColumn: Int = column,
    val category: String,
    val priority: Int,
    val explanation: String = "",
    val quickFix: LintQuickFixDto? = null
)

@Serializable
data class RpcRequest(
    val id: Int? = null,
    val method: String,
    val params: Map<String, String> = emptyMap()
)

@Serializable
data class RpcResponse(
    val id: Int? = null,
    val result: RpcResult? = null,
    val error: RpcError? = null
)

@Serializable
data class RpcResult(
    val success: Boolean = true,
    val message: String? = null,
    val issues: List<LintIssueDto>? = null,
    val checksCount: Int? = null
)

@Serializable
data class RpcError(
    val code: Int,
    val message: String
)

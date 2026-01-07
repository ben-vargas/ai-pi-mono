/**
 * Convert MCP JSON Schema to TypeBox schema
 *
 * MCP tools use JSON Schema (draft 2020-12) for parameter definitions.
 * Pi's extension system uses TypeBox. This module bridges the gap.
 */

import { Type, type TSchema } from "@sinclair/typebox";

interface JsonSchema {
	type?: string | string[];
	properties?: Record<string, JsonSchema>;
	required?: string[];
	items?: JsonSchema;
	description?: string;
	enum?: unknown[];
	const?: unknown;
	oneOf?: JsonSchema[];
	anyOf?: JsonSchema[];
	allOf?: JsonSchema[];
	$ref?: string;
	default?: unknown;
	minimum?: number;
	maximum?: number;
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	format?: string;
	additionalProperties?: boolean | JsonSchema;
}

/**
 * Convert a JSON Schema to TypeBox schema.
 * Handles common cases; complex schemas may need manual adjustment.
 */
export function jsonSchemaToTypebox(schema: JsonSchema | undefined): TSchema {
	if (!schema) {
		return Type.Unknown();
	}

	// Handle type arrays (e.g., ["string", "null"])
	if (Array.isArray(schema.type)) {
		const types = schema.type.filter((t) => t !== "null");
		const hasNull = schema.type.includes("null");
		const baseSchema = types.length === 1 ? jsonSchemaToTypebox({ ...schema, type: types[0] }) : Type.Unknown();

		return hasNull ? Type.Optional(baseSchema) : baseSchema;
	}

	// Handle enum
	if (schema.enum) {
		if (schema.enum.every((v) => typeof v === "string")) {
			return Type.Union(schema.enum.map((v) => Type.Literal(v as string)));
		}
		return Type.Unknown();
	}

	// Handle const
	if (schema.const !== undefined) {
		return Type.Literal(schema.const as string | number | boolean);
	}

	// Handle oneOf/anyOf
	if (schema.oneOf || schema.anyOf) {
		const schemas = (schema.oneOf || schema.anyOf) as JsonSchema[];
		return Type.Union(schemas.map(jsonSchemaToTypebox));
	}

	// Handle by type
	switch (schema.type) {
		case "string":
			return buildStringSchema(schema);

		case "number":
		case "integer":
			return buildNumberSchema(schema);

		case "boolean":
			return Type.Boolean({ description: schema.description });

		case "array":
			return Type.Array(jsonSchemaToTypebox(schema.items), {
				description: schema.description,
			});

		case "object":
			return buildObjectSchema(schema);

		case "null":
			return Type.Null();

		default:
			// No type specified - treat as unknown or object with properties
			if (schema.properties) {
				return buildObjectSchema(schema);
			}
			return Type.Unknown({ description: schema.description });
	}
}

function buildStringSchema(schema: JsonSchema): TSchema {
	const opts: Record<string, unknown> = {};
	if (schema.description) opts.description = schema.description;
	if (schema.minLength !== undefined) opts.minLength = schema.minLength;
	if (schema.maxLength !== undefined) opts.maxLength = schema.maxLength;
	if (schema.pattern) opts.pattern = schema.pattern;
	if (schema.default !== undefined) opts.default = schema.default;

	return Type.String(opts);
}

function buildNumberSchema(schema: JsonSchema): TSchema {
	const opts: Record<string, unknown> = {};
	if (schema.description) opts.description = schema.description;
	if (schema.minimum !== undefined) opts.minimum = schema.minimum;
	if (schema.maximum !== undefined) opts.maximum = schema.maximum;
	if (schema.default !== undefined) opts.default = schema.default;

	return schema.type === "integer" ? Type.Integer(opts) : Type.Number(opts);
}

function buildObjectSchema(schema: JsonSchema): TSchema {
	const properties: Record<string, TSchema> = {};
	const required = new Set(schema.required || []);

	if (schema.properties) {
		for (const [key, propSchema] of Object.entries(schema.properties)) {
			const propType = jsonSchemaToTypebox(propSchema);
			properties[key] = required.has(key) ? propType : Type.Optional(propType);
		}
	}

	return Type.Object(properties, { description: schema.description });
}

/**
 * Create a simple passthrough schema that accepts any object.
 * Use this when full schema conversion isn't critical.
 */
export function createPassthroughSchema(description?: string): TSchema {
	return Type.Record(Type.String(), Type.Unknown(), { description });
}

/**
 * Tree-sitter query source per grammar, derived from actually inspecting
 * each grammar's parse tree (see backend/probe*.mjs during development)
 * rather than assumed node names.
 */

export const DEFINITION_QUERIES: Record<string, string> = {
  typescript: `
    (class_declaration name: (type_identifier) @class.name) @class.def
    (interface_declaration name: (type_identifier) @interface.name) @interface.def
    (function_declaration name: (identifier) @function.name) @function.def
    (method_definition name: (property_identifier) @method.name) @method.def
  `,
  tsx: `
    (class_declaration name: (type_identifier) @class.name) @class.def
    (interface_declaration name: (type_identifier) @interface.name) @interface.def
    (function_declaration name: (identifier) @function.name) @function.def
    (method_definition name: (property_identifier) @method.name) @method.def
  `,
  javascript: `
    (class_declaration name: (identifier) @class.name) @class.def
    (function_declaration name: (identifier) @function.name) @function.def
    (method_definition name: (property_identifier) @method.name) @method.def
  `,
  python: `
    (class_definition name: (identifier) @class.name) @class.def
    (function_definition name: (identifier) @function.name) @function.def
  `,
  csharp: `
    (class_declaration name: (identifier) @class.name) @class.def
    (interface_declaration name: (identifier) @interface.name) @interface.def
    (method_declaration name: (identifier) @method.name) @method.def
  `,
};

export const CALL_QUERIES: Record<string, string> = {
  typescript: `
    (call_expression function: (identifier) @call.name)
    (call_expression function: (member_expression property: (property_identifier) @call.name))
  `,
  tsx: `
    (call_expression function: (identifier) @call.name)
    (call_expression function: (member_expression property: (property_identifier) @call.name))
  `,
  javascript: `
    (call_expression function: (identifier) @call.name)
    (call_expression function: (member_expression property: (property_identifier) @call.name))
  `,
  python: `
    (call function: (identifier) @call.name)
    (call function: (attribute attribute: (identifier) @call.name))
  `,
  csharp: `
    (invocation_expression function: (identifier) @call.name)
    (invocation_expression function: (member_access_expression name: (identifier) @call.name))
  `,
};

export const IMPORT_QUERIES: Record<string, string> = {
  typescript: `(import_statement) @import.def`,
  tsx: `(import_statement) @import.def`,
  javascript: `(import_statement) @import.def`,
  python: `
    (import_statement) @import.def
    (import_from_statement) @import.def
  `,
  csharp: `(using_directive) @import.def`,
};

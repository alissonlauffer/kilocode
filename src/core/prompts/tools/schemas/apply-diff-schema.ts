import { ToolArgs } from "../types"
import { BaseToolSchema } from "./base-tool-schema"

export function generateApplyDiffSchema(args: ToolArgs): BaseToolSchema {
	if (args?.diffStrategy?.getName() === "MultiFileSearchReplace") {
		return generateMultipleApplyDiffSchema(args)
	}
	const schema: BaseToolSchema = {
		name: "apply_diff",
		description: `File edit tool. Apply precise, targeted modifications to existing files using search-and-replace operations. This tool is designed for SURGICAL EDITS to existing code, NOT for creating new files or making wholesale changes.

PURPOSE: Make specific changes to existing code by locating exact text patterns and replacing them.

RULES:
1. MUST use exact text matching - include all whitespace, indentation, and punctuation
2. Use read_file tool FIRST if unsure about exact content
3. Should use apply_diff more finely, the smallest unit is a line or multiple lines, not the function.
4. Make multiple changes in ONE call using multiple diff
5. Check for affected syntax (brackets, parentheses) throughout the file
6. Prefer this tool over rewriting entire functions or files

CRITICAL: Search text must match the file content EXACTLY or the operation will fail.`,
		parameters: [
			{
				name: "path",
				type: "string",
				description: `The path of the file to modify (relative to the current workspace directory ${args.cwd})`,
				required: true,
			},
			{
				name: "diff",
				type: "array",
				description: `The search/replace block defining the changes.

Original file:
\`\`\`
1 | def calculate_total(items):
2 |     total = 0
3 |     for item in items:
4 |         total += item
5 |     return total
\`\`\`

Search/Replace Example:
[{"start_line":1,"search":"def calculate_total(items):\n    total = 0\n    for item in items:\n        total += item\n    return total","replace":"def calculate_total(items):\n    \"\"\"Calculate total with 10% markup\"\"\"\n    return sum(item * 1.1 for item in items)"}]

Multiple Search/Replace Ex:
[{"start_line":1,"search":"def calculate_total(items):\n    total = 0","replace":"def calculate_sum(items):\n    sum = 0"},{"start_line":4,"search":"        total += item\n    return total","replace":"        sum += item\n    return sum "}]
`,
				required: true,
				items: {
					name: "diffItem",
					type: "object",
					description: "A single search/replace operation.",
					required: true,
					properties: {
						start_line: {
							name: "start_line",
							type: "number",
							description: "The line number of original content where the search block starts.",
							required: true,
						},
						search: {
							name: "search",
							type: "string",
							description:
								"SEARCH BLOCK: The exact text to find in the file. Must match PRECISELY including all whitespace, tabs, and indentation. Copy directly from the file - do not modify or escape the text.",
							required: true,
						},
						replace: {
							name: "replace",
							type: "string",
							description:
								"REPLACE BLOCK: The new text to replace the search block with. Include proper indentation and formatting.",
							required: true,
						},
					},
				},
			},
		],

		systemPrompt: `## apply_diff
Description: Request to apply PRECISE, TARGETED modifications to an existing file by searching for specific sections of content and replacing them. This tool is for SURGICAL EDITS ONLY - specific changes to existing code.
You can perform multiple distinct search and replace operations within a single \`apply_diff\` call by providing multiple SEARCH/REPLACE blocks in the \`diff\` parameter. This is the preferred way to make several targeted changes efficiently.
The SEARCH section must exactly match existing content including whitespace and indentation.
If you're not confident in the exact content to search for, use the read_file tool first to get the exact content.
When applying the diffs, be extra careful to remember to change any closing brackets or other syntax that may be affected by the diff farther down in the file.
ALWAYS make as many changes in a single 'apply_diff' request as possible using multiple SEARCH/REPLACE blocks

Parameters:
- path: (required) The path of the file to modify (relative to the current workspace directory ${args.cwd})
- diff: (required) The search/replace block defining the changes.

Diff format:
\`\`\`
<<<<<<< SEARCH
:start_line: (required) The line number of original content where the search block starts.
-------
[exact content to find including whitespace]
=======
[new content to replace with]
>>>>>>> REPLACE

\`\`\`


Example:

Original file:
\`\`\`
1 | def calculate_total(items):
2 |     total = 0
3 |     for item in items:
4 |         total += item
5 |     return total
\`\`\`

Search/Replace content:
\`\`\`
<<<<<<< SEARCH
:start_line:1
-------
def calculate_total(items):
    total = 0
    for item in items:
        total += item
    return total
=======
def calculate_total(items):
    """Calculate total with 10% markup"""
    return sum(item * 1.1 for item in items)
>>>>>>> REPLACE

\`\`\`

Search/Replace content with multiple edits:
\`\`\`
<<<<<<< SEARCH
:start_line:1
-------
def calculate_total(items):
    sum = 0
=======
def calculate_sum(items):
    sum = 0
>>>>>>> REPLACE

<<<<<<< SEARCH
:start_line:4
-------
        total += item
    return total
=======
        sum += item
    return sum 
>>>>>>> REPLACE
\`\`\`


Usage:
<apply_diff>
<path>File path here</path>
<diff>
Your search/replace content here
You can use multi search/replace block in one diff block, but make sure to include the line numbers for each block.
Only use a single line of '=======' between search and replacement content, because multiple '=======' will corrupt the file.
</diff>
</apply_diff>`,
	}

	return schema
}

function generateMultipleApplyDiffSchema(args: ToolArgs): BaseToolSchema {
	const schema: BaseToolSchema = {
		name: "apply_diff",
		description: `File edit tool. Apply precise, targeted modifications to one or more files using search-and-replace operations. This is the PREFERRED multi-file version that supports batch operations across multiple files for maximum efficiency.

PURPOSE: Make specific changes to existing code by locating exact text patterns and replacing them across multiple files in a single operation.

RULES:
1. **BATCH FIRST**: ALWAYS use multiple files in a single operation when possible
2. **EXACT MATCHING**: Search text must match file content PRECISELY 
3. **READ FIRST**: Use read_file tool if unsure about exact content
4. **EFFICIENCY**: Group related changes across files into one call
5. **SYNTAX AWARENESS**: Check for affected syntax throughout files

CRITICAL: This tool maximizes efficiency by handling multiple files at once - use it whenever you need to make changes to more than one file.`,
		parameters: [
			{
				name: "file",
				type: "array",
				description: `One or more file change objects.`,
				required: true,
				items: {
					name: "fileItem",
					type: "object",
					description: "A file modification object containing the path and diff operations.",
					required: true,
					properties: {
						path: {
							name: "path",
							type: "string",
							description: `The path of the file to modify (relative to the current workspace directory ${args.cwd})`,
							required: true,
						},
						diff: {
							name: "diff",
							type: "array",
							description:
								"One or more diff operations for this file - batch multiple changes per file for efficiency.",
							required: true,
							items: {
								name: "diffItem",
								type: "object",
								description:
									"A single search-and-replace operation. This object contains the search criteria and the replacement content.",
								required: true,
								properties: {
									search: {
										name: "search",
										type: "string",
										description:
											"SEARCH BLOCK: The exact text to find in the file. Must match PRECISELY including all whitespace, tabs, and indentation. Copy directly from the file - do not modify or escape the text.",
										required: true,
									},
									replace: {
										name: "replace",
										type: "string",
										description:
											"REPLACE BLOCK: The new text to replace the search block with. Include proper indentation and formatting.",
										required: true,
									},
									start_line: {
										name: "start_line",
										type: "number",
										description:
											"The line number of original content where the search block starts",
										required: false,
									},
								},
							},
						},
					},
				},
			},
		],
		systemPrompt: `## apply_diff

Description: Request to apply PRECISE, TARGETED modifications to one or more files by searching for specific sections of content and replacing them. This tool is for SURGICAL EDITS ONLY - specific changes to existing code. This tool supports both single-file and multi-file operations, allowing you to make changes across multiple files in a single request.

**IMPORTANT: You MUST use multiple files in a single operation whenever possible to maximize efficiency and minimize back-and-forth.**

You can perform multiple distinct search and replace operations within a single \`apply_diff\` call by providing multiple SEARCH/REPLACE blocks in the \`diff\` parameter. This is the preferred way to make several targeted changes efficiently.

The SEARCH section must exactly match existing content including whitespace and indentation.
If you're not confident in the exact content to search for, use the read_file tool first to get the exact content.
When applying the diffs, be extra careful to remember to change any closing brackets or other syntax that may be affected by the diff farther down in the file.
ALWAYS make as many changes in a single 'apply_diff' request as possible using multiple SEARCH/REPLACE blocks

Parameters:
- args: Contains one or more file elements, where each file contains:
  - path: (required) The path of the file to modify (relative to the current workspace directory ${args.cwd})
  - diff: (required) One or more diff elements containing:
    - content: (required) The search/replace block defining the changes.
    - start_line: (required) The line number of original content where the search block starts.

Diff format:
\`\`\`
<<<<<<< SEARCH
:start_line: (required) The line number of original content where the search block starts.
-------
[exact content to find including whitespace]
=======
[new content to replace with]
>>>>>>> REPLACE
\`\`\`

Example:

Original file:
\`\`\`
1 | def calculate_total(items):
2 |     total = 0
3 |     for item in items:
4 |         total += item
5 |     return total
\`\`\`

Search/Replace content:
<apply_diff>
<args>
<file>
  <path>eg.file.py</path>
  <diff>
    <content><![CDATA[
<<<<<<< SEARCH
def calculate_total(items):
    total = 0
    for item in items:
        total += item
    return total
=======
def calculate_total(items):
    """Calculate total with 10% markup"""
    return sum(item * 1.1 for item in items)
>>>>>>> REPLACE
]]></content>
  </diff>
</file>
</args>
</apply_diff>

Search/Replace content with multi edits across multiple files:
<apply_diff>
<args>
<file>
  <path>eg.file.py</path>
  <diff>
    <content><![CDATA[
<<<<<<< SEARCH
def calculate_total(items):
    sum = 0
=======
def calculate_sum(items):
    sum = 0
>>>>>>> REPLACE
]]></content>
  </diff>
  <diff>
    <content><![CDATA[
<<<<<<< SEARCH
        total += item
    return total
=======
        sum += item
    return sum 
>>>>>>> REPLACE
]]></content>
  </diff>
</file>
<file>
  <path>eg.file2.py</path>
  <diff>
    <content><![CDATA[
<<<<<<< SEARCH
def greet(name):
    return "Hello " + name
=======
def greet(name):
    return f"Hello {name}!"
>>>>>>> REPLACE
]]></content>
  </diff>
</file>
</args>
</apply_diff>


Usage:
<apply_diff>
<args>
<file>
  <path>File path here</path>
  <diff>
    <content>
Your search/replace content here
You can use multi search/replace block in one diff block, but make sure to include the line numbers for each block.
Only use a single line of '=======' between search and replacement content, because multiple '=======' will corrupt the file.
    </content>
    <start_line>1</start_line>
  </diff>
</file>
<file>
  <path>Another file path</path>
  <diff>
    <content>
Another search/replace content here
You can apply changes to multiple files in a single request.
Each file requires its own path, start_line, and diff elements.
    </content>
    <start_line>5</start_line>
  </diff>
</file>
</args>
</apply_diff>`,
	}

	return schema
}

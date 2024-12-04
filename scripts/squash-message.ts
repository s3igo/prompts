import { err, ok, Result } from "npm:neverthrow@8.1.1";
import { parseArgs } from "node:util";

type InputError = {
    type: "FILE_READ_ERROR" | "STDIN_READ_ERROR" | "ARGUMENT_ERROR";
    message: string;
    cause?: unknown;
};

const readFromFile = (path: string): Promise<Result<string, InputError>> =>
    Deno.readTextFile(path)
        .then(ok)
        .catch((cause) =>
            err({
                type: "FILE_READ_ERROR",
                message: "Failed to read file",
                cause,
            })
        );

const readFromStdin = async (): Promise<Result<string, InputError>> => {
    try {
        const decoder = new TextDecoder();
        let input = "";
        for await (const chunk of Deno.stdin.readable) {
            input += decoder.decode(chunk);
        }
        return ok(input);
    } catch (cause) {
        return err({
            type: "STDIN_READ_ERROR",
            message: "Failed to read from stdin",
            cause,
        });
    }
};

const showHelp = () => {
    console.log(`
Usage: squash-message [options] [filepath]

Generate a squash commit message template.

Options:
  -h, --help     Show this help message

Arguments:
  filepath       Path to input file (reads from stdin if omitted)

Examples:
  deno run --allow-read scripts/squash-message.ts input.txt
  cat input.txt | deno run --allow-read scripts/squash-message.ts
`);
    Deno.exit(0);
};

const getInput = (filePath?: string): Promise<Result<string, InputError>> =>
    filePath ? readFromFile(filePath) : readFromStdin();

const createTemplate = (input: string) =>
    `\`<commit_message>\`タグで囲まれたコミットメッセージのリストに基づいて、次の指示に従いGitのsquashコミットメッセージを生成してください。

1. Subjectは50文字以下で変更内容を要約すること。
2. Subjectにはコミットメッセージの型（例: fix, feat, docsなど）を含めないこと。
3. Bodyには変更内容の詳細を記述し、1行あたり72文字以下にすること。
4. Bodyには、指定されたコミットメッセージの完全なリストを含めること。各行の先頭に\`*\`を付ける形式で列挙する。ただし、入力内で既に行頭に\`*\`が付いている行はそのままにすること。
5. 入力にコメント行（例: \`#\`で始まる行）が含まれている場合、それをそのまま保持すること。
6. squashメッセージ以外の出力には、必ず行の先頭に\`#\`を付けること。

例を以下の\`<example>\`タグ内で示します。

<example>
  例1:

  <example_1>
    <example_commit_message>
      perf: Optimize image loading on the homepage

      feat: Implement lazy loading for product images

      fix: Fix incorrect image alt text for accessibility

      docs: Add lazy loading details to CONTRIBUTING.md

      # Keep this as a comment
    </example_commit_message>

    <example_expected_output>
      # Squash message
      Improve image performance and accessibility

      * perf: Optimize image loading on the homepage

      * feat: Implement lazy loading for product images

      * fix: Fix incorrect image alt text for accessibility

      * docs: Add lazy loading details to CONTRIBUTING.md

      # Keep this as a comment
    </example_expected_output>
  </example_1>

  例2:

  <example_2>
    <example_commit_message>
      # This is a combination of 4 commits.
      # This is the 1st commit message:

      fix: Fix form validation errors

      # This is the commit message #2:

      fix: Add required check for username field

      # This is the commit message #3:

      * feat: Add sort option to search functionality

      # This is the commit message #4:

      docs: Update README with new search functionality

      # refactor: Code cleanup
    </example_commit_message>

    <example_expected_output>
      Fix form validation and enhance search functionality

      # This is a combination of 4 commits.
      # This is the 1st commit message:

      * fix: Fix form validation errors

      # This is the commit message #2:

      * fix: Add required check for username field

      # This is the commit message #3:

      * feat: Add sort option to search functionality

      # This is the commit message #4:

      * docs: Update README with new search functionality

      # refactor: Code cleanup
    </example_expected_output>
  </example_2>
</example>

<commit_message>
${input}
</commit_message>`;

const validateArgs = (
    positionals: string[],
): Result<string | undefined, InputError> => {
    if (positionals.length > 1) {
        return err({
            type: "FILE_READ_ERROR",
            message: "Too many arguments. Expected 0 or 1 filepath argument.",
        });
    }
    return ok(positionals[0]);
};

const parseArguments = (): Result<string | undefined, InputError> => {
    try {
        const { values, positionals } = parseArgs({
            args: Deno.args,
            options: {
                help: {
                    type: "boolean",
                    short: "h",
                },
            },
            allowPositionals: true,
        });

        if (values.help) {
            showHelp();
        }

        return validateArgs(positionals);
    } catch (cause) {
        return err({
            type: "ARGUMENT_ERROR",
            message: "Failed to parse arguments",
            cause,
        });
    }
};

const main = async (): Promise<void> => {
    const filePath = parseArguments();

    if (filePath.isErr()) {
        console.error(filePath.error.message);
        Deno.exit(1);
    }

    const result = await getInput(filePath.value);

    result
        .map((text: string) => text.trim())
        .map(createTemplate)
        .match(
            console.log,
            (e: InputError) => {
                console.error(e.message, e.cause);
                Deno.exit(1);
            },
        );
};

main().catch((e) => {
    console.error("Unexpected error occurred:", e);
    Deno.exit(1);
});

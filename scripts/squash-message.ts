import { err, ok, Result, ResultAsync, safeTry } from "npm:neverthrow@8.1.1";
import { parseArgs } from "node:util";
import { assertEquals } from "jsr:@std/assert@1.0.8";

const readFromFile = ResultAsync.fromThrowable(
    Deno.readTextFile,
    (e) => new Error("Failed to read file", { cause: e }),
);

Deno.test("readFromFile - success", async () => {
    const tempFile = await Deno.makeTempFile();
    await Deno.writeTextFile(tempFile, "test content");

    const result = await readFromFile(tempFile);
    assertEquals(result, ok("test content"));

    await Deno.remove(tempFile);
});

Deno.test("readFromFile - error", async () => {
    const result = await readFromFile("non-existent-file.txt");
    assertEquals(result.isErr(), true);
});

const readFromStdin = ResultAsync.fromThrowable(async (): Promise<string> => {
    const decoder = new TextDecoder(undefined, { fatal: true });
    let input = "";
    for await (const chunk of Deno.stdin.readable) {
        input += decoder.decode(chunk);
    }
    return input;
}, (e) => new Error("Failed to read from stdin", { cause: e }));

Deno.test("readFromStdin - mock success", async () => {
    const originalStdin = Deno.stdin;
    try {
        const mockInput = new TextEncoder().encode("test input");
        const readable = new ReadableStream({
            start(controller) {
                controller.enqueue(mockInput);
                controller.close();
            },
        });

        // @ts-expect-error: stdinをモックする
        Deno.stdin = { readable };

        const result = await readFromStdin();
        assertEquals(result, ok("test input"));
    } finally {
        // @ts-expect-error: stdinを元に戻す
        Deno.stdin = originalStdin;
    }
});

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
};

const getInput = (filePath?: string): ResultAsync<string, Error> =>
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

Deno.test("createTemplate - basic functionality", () => {
    const input = "feat: Add new feature\n\nDescription of the feature";
    const result = createTemplate(input);

    assertEquals(result.includes(input), true);
    assertEquals(result.includes("<commit_message>"), true);
    assertEquals(result.includes("</commit_message>"), true);
});

Deno.test("createTemplate - preserves input formatting", () => {
    const input = "# Comment line\n* Bullet point";
    const result = createTemplate(input);

    assertEquals(result.includes("# Comment line"), true);
    assertEquals(result.includes("* Bullet point"), true);
});

const validateArgs = (
    positionals: string[],
): Result<string | undefined, Error> => {
    if (positionals.length > 1) {
        return err(
            new Error("Too many arguments. Expected 0 or 1 filepath argument."),
        );
    }
    return ok(positionals[0]);
};

Deno.test("validateArgs - success with no args", () => {
    const result = validateArgs([]);
    assertEquals(result, ok(undefined));
});

Deno.test("validateArgs - success with one arg", () => {
    const result = validateArgs(["file.txt"]);
    assertEquals(result, ok("file.txt"));
});

Deno.test("validateArgs - error with too many args", () => {
    const result = validateArgs(["file1.txt", "file2.txt"]);
    assertEquals(result.isErr(), true);
});

const parseArguments = Result.fromThrowable(() => {
    return parseArgs({
        args: Deno.args,
        options: {
            help: {
                type: "boolean",
                short: "h",
            },
        },
        allowPositionals: true,
    });
}, (e) => new Error("Failed to parse arguments", { cause: e }));

const main = () => {
    return safeTry<void, Error>(async function* () {
        const { values, positionals } = yield* parseArguments();

        if (values.help) {
            showHelp();
            Deno.exit(0);
        }

        const filePath = yield* validateArgs(positionals);
        const input = yield* await getInput(filePath);

        const template = createTemplate(input.trim());
        console.log(template);

        Deno.exit(0);
    });
};

main().mapErr((e) => {
    console.error(e.message);
    Deno.exit(1);
});

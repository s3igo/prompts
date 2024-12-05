import { err, ok, Result, ResultAsync, safeTry } from "npm:neverthrow@8.1.1";
import { createAnthropic } from "npm:@ai-sdk/anthropic@1.0.2";
import { streamText } from "npm:ai@4.0.9";
import { assertEquals } from "jsr:@std/assert@1.0.8";
import { parseArgs } from "node:util";

const readFromFile = ResultAsync.fromThrowable(
    Deno.readTextFile,
    (e) => new Error("Failed to read file", { cause: e }),
);

Deno.test("readFromFile", async (t) => {
    await t.step("success", async () => {
        const tempFile = await Deno.makeTempFile();
        await Deno.writeTextFile(tempFile, "test content");

        const result = await readFromFile(tempFile);
        assertEquals(result, ok("test content"));

        await Deno.remove(tempFile);
    });

    await t.step("error", async () => {
        const result = await readFromFile("non-existent-file.txt");
        assertEquals(result.isErr(), true);
    });
});

const readFromStdin = ResultAsync.fromThrowable<[], string, Error>(async () => {
    const decoder = new TextDecoder(undefined, { fatal: true });
    let input = "";
    for await (const chunk of Deno.stdin.readable) {
        input += decoder.decode(chunk);
    }
    return input;
}, (e) => new Error("Failed to read from stdin", { cause: e }));

Deno.test("readFromStdin", async (t) => {
    await t.step("mock success", async () => {
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
});

const showHelp = () => {
    console.log(`Generate a squash commit message template

Usage:
  squash-message [OPTIONS] [filepath]
  deno run --allow-read --allow-net --allow-env scripts/squash-message.ts [options] [filepath]

Arguments:
  filepath       Path to input file (reads from stdin if omitted)

Options:
  -h, --help            Show this help message
  -k, --api-key <key>   API key for Anthropic Claude (highest priority)
  -d, --dry-run         Display the generated prompt text without sending to LLM

Environment Variables:
  SQUASH_MESSAGE_API_KEY  API key for Anthropic Claude (preferred)
  ANTHROPIC_API_KEY       Alternative API key for Anthropic Claude

Examples:
  squash-message input.txt
  cat input.txt | squash-message

  # In Vim, you can use it as a filter command:
  :%!squash-message
`);
};

const getInput = (filePath?: string): ResultAsync<string, Error> =>
    filePath ? readFromFile(filePath) : readFromStdin();

const createPrompt = (input: string) =>
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

Deno.test("createPrompt", async (t) => {
    await t.step("basic functionality", () => {
        const input = "feat: Add new feature\n\nDescription of the feature";
        const result = createPrompt(input);

        assertEquals(result.includes(input), true);
        assertEquals(result.includes("<commit_message>"), true);
        assertEquals(result.includes("</commit_message>"), true);
    });

    await t.step("preserves input formatting", () => {
        const input = "# Comment line\n* Bullet point";
        const result = createPrompt(input);

        assertEquals(result.includes("# Comment line"), true);
        assertEquals(result.includes("* Bullet point"), true);
    });
});

const parsePositionals = (
    positionals: string[],
): Result<string | undefined, Error> => {
    const error = () =>
        new Error("Too many arguments. Expected 0 or 1 filepath argument.");
    return positionals.length > 1 ? err(error()) : ok(positionals[0]);
};

Deno.test("parsePositionals", async (t) => {
    await t.step("success with no args", () => {
        const result = parsePositionals([]);
        assertEquals(result, ok(undefined));
    });

    await t.step("success with one arg", () => {
        const result = parsePositionals(["file.txt"]);
        assertEquals(result, ok("file.txt"));
    });

    await t.step("error with too many args", () => {
        const result = parsePositionals(["file1.txt", "file2.txt"]);
        assertEquals(result.isErr(), true);
    });
});

const parseArguments = Result.fromThrowable(() => {
    return parseArgs({
        args: Deno.args,
        options: {
            help: {
                type: "boolean",
                short: "h",
            },
            "api-key": {
                type: "string",
                short: "k",
            },
            "dry-run": {
                type: "boolean",
                short: "d",
            },
        },
        allowPositionals: true,
    });
}, (e) => new Error("Failed to parse arguments", { cause: e }));

const writeStreamText = ResultAsync.fromThrowable<
    [AsyncIterable<string>],
    void,
    Error
>(async (textStream) => {
    const encoder = new TextEncoder();
    for await (const text of textStream) {
        Deno.stdout.write(encoder.encode(text));
    }
}, (e) => new Error("Failed to write stream text", { cause: e }));

const getApiKey = (cliApiKey?: string): Result<string, Error> => {
    const apiKey = cliApiKey ??
        Deno.env.get("SQUASH_MESSAGE_API_KEY") ??
        Deno.env.get("ANTHROPIC_API_KEY");
    return apiKey ? ok(apiKey) : err(new Error("API key not found"));
};

Deno.test("getApiKey", async (t) => {
    await t.step("success with SQUASH_MESSAGE_API_KEY", () => {
        try {
            Deno.env.set("SQUASH_MESSAGE_API_KEY", "test-key-1");
            const result = getApiKey();
            assertEquals(result, ok("test-key-1"));
        } finally {
            Deno.env.delete("SQUASH_MESSAGE_API_KEY");
        }
    });

    await t.step("success with ANTHROPIC_API_KEY", () => {
        try {
            Deno.env.set("ANTHROPIC_API_KEY", "test-key-2");
            const result = getApiKey();
            assertEquals(result, ok("test-key-2"));
        } finally {
            Deno.env.delete("ANTHROPIC_API_KEY");
        }
    });

    await t.step("error when no key is set", () => {
        Deno.env.delete("SQUASH_MESSAGE_API_KEY");
        Deno.env.delete("ANTHROPIC_API_KEY");
        const result = getApiKey();
        assertEquals(result.isErr(), true);
    });

    await t.step("success with CLI api key", () => {
        const cliApiKey = "cli-test-key";
        const result = getApiKey(cliApiKey);
        assertEquals(result, ok(cliApiKey));
    });

    await t.step("respects API key priority order", () => {
        try {
            Deno.env.set("SQUASH_MESSAGE_API_KEY", "squash-key");
            Deno.env.set("ANTHROPIC_API_KEY", "anthropic-key");

            // CLI引数が最優先
            const cliApiKey = "cli-test-key";
            let result = getApiKey(cliApiKey);
            assertEquals(result, ok(cliApiKey));

            // SQUASH_MESSAGE_API_KEYが次に優先
            result = getApiKey();
            assertEquals(result, ok("squash-key"));
        } finally {
            Deno.env.delete("SQUASH_MESSAGE_API_KEY");
            Deno.env.delete("ANTHROPIC_API_KEY");
        }
    });
});

const main = () => {
    return safeTry<void, Error>(async function* () {
        const { values, positionals } = yield* parseArguments();

        if (values.help) {
            showHelp();
            Deno.exit(0);
        }

        const filePath = yield* parsePositionals(positionals);
        const input = yield* await getInput(filePath);
        const prompt = createPrompt(input.trim());

        if (values["dry-run"]) {
            console.log(prompt);
            Deno.exit(0);
        }

        const { textStream } = streamText({
            model: yield* getApiKey(values["api-key"])
                .map((apiKey) => createAnthropic({ apiKey }))
                .map((anthropic) => anthropic("claude-3-5-sonnet-20241022")),
            prompt,
            maxTokens: 1024,
            temperature: 0,
        });

        const _ = yield* writeStreamText(textStream);
        _ satisfies void;

        Deno.exit(0);
    });
};

main().mapErr((e) => {
    console.error(e.message);
    Deno.exit(1);
});

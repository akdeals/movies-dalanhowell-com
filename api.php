<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');

const START_DELAY_MS = 1800;
const SPIN_DURATION_MS = 7200;

$baseDirectory = __DIR__;
$csvPath = $baseDirectory . DIRECTORY_SEPARATOR . 'movies.csv';
$dataDirectory = $baseDirectory . DIRECTORY_SEPARATOR . 'data';
$statePath = $dataDirectory . DIRECTORY_SEPARATOR . 'state.json';
$lockPath = $dataDirectory . DIRECTORY_SEPARATOR . 'state.lock';

function sendJson(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function nowMilliseconds(): int
{
    return (int) round(microtime(true) * 1000);
}

function loadMovies(string $path): array
{
    if (!is_readable($path)) {
        throw new RuntimeException('movies.csv could not be read.');
    }

    $handle = fopen($path, 'rb');
    if ($handle === false) {
        throw new RuntimeException('movies.csv could not be opened.');
    }

    $movies = [];
    $firstRow = true;

    while (($row = fgetcsv($handle, 0, ',', '"', '')) !== false) {
        if (!isset($row[0])) {
            continue;
        }

        $title = trim((string) $row[0]);
        if ($firstRow && strtolower($title) === 'title') {
            $firstRow = false;
            continue;
        }
        $firstRow = false;

        if ($title !== '') {
            $movies[] = $title;
        }
    }

    fclose($handle);

    if (count($movies) < 2) {
        throw new RuntimeException('movies.csv must contain at least two movie titles.');
    }

    return array_values(array_unique($movies));
}

function defaultState(string $movieHash, int $spinId = 0): array
{
    return [
        'spinId' => $spinId,
        'startAt' => 0,
        'durationMs' => SPIN_DURATION_MS,
        'selectedIndex' => null,
        'selectedTitle' => null,
        'startRotation' => 0,
        'endRotation' => 0,
        'movieHash' => $movieHash,
        'updatedAt' => nowMilliseconds()
    ];
}

function readState(string $path): ?array
{
    if (!is_readable($path)) {
        return null;
    }

    $raw = file_get_contents($path);
    if ($raw === false || trim($raw) === '') {
        return null;
    }

    $state = json_decode($raw, true);
    return is_array($state) ? $state : null;
}

function writeState(string $path, array $state): void
{
    $temporaryPath = $path . '.tmp';
    $json = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    if ($json === false || file_put_contents($temporaryPath, $json . PHP_EOL) === false) {
        throw new RuntimeException('The shared wheel state could not be saved.');
    }

    if (!rename($temporaryPath, $path)) {
        @unlink($temporaryPath);
        throw new RuntimeException('The shared wheel state could not be updated.');
    }
}

function publicPayload(array $movies, string $movieHash, array $state): array
{
    unset($state['movieHash']);
    return [
        'serverTimeMs' => nowMilliseconds(),
        'movieHash' => $movieHash,
        'movies' => $movies,
        'state' => $state
    ];
}

if (!in_array($_SERVER['REQUEST_METHOD'], ['GET', 'POST'], true)) {
    header('Allow: GET, POST');
    sendJson(['error' => 'Method not allowed.'], 405);
}

try {
    $movies = loadMovies($csvPath);
    $movieHash = hash('sha256', implode("\n", $movies));

    if (!is_dir($dataDirectory) && !mkdir($dataDirectory, 0755, true) && !is_dir($dataDirectory)) {
        throw new RuntimeException('The data directory could not be created.');
    }

    $lockHandle = fopen($lockPath, 'c+');
    if ($lockHandle === false || !flock($lockHandle, LOCK_EX)) {
        throw new RuntimeException('The shared wheel state could not be locked.');
    }

    try {
        $state = readState($statePath);
        if ($state === null) {
            $state = defaultState($movieHash);
            writeState($statePath, $state);
        }

        if (($state['movieHash'] ?? '') !== $movieHash) {
            $state = defaultState($movieHash, (int) ($state['spinId'] ?? 0) + 1);
            writeState($statePath, $state);
        }

        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $rawBody = file_get_contents('php://input');
            $body = json_decode($rawBody ?: '{}', true);
            $action = is_array($body) ? ($body['action'] ?? '') : '';

            if ($action !== 'spin') {
                throw new InvalidArgumentException('Unknown action.');
            }

            $now = nowMilliseconds();
            $finishAt = (int) ($state['startAt'] ?? 0) + (int) ($state['durationMs'] ?? 0);
            $spinIsActive = ($state['selectedIndex'] ?? null) !== null && $now < $finishAt;

            if (!$spinIsActive) {
                $movieCount = count($movies);
                $selectedIndex = random_int(0, $movieCount - 1);
                $previousEnd = (float) ($state['endRotation'] ?? 0);
                $degreesPerMovie = 360.0 / $movieCount;
                $targetModulo = fmod(360.0 - (($selectedIndex + 0.5) * $degreesPerMovie), 360.0);
                $currentModulo = fmod($previousEnd, 360.0);
                if ($currentModulo < 0) {
                    $currentModulo += 360.0;
                }
                $delta = fmod($targetModulo - $currentModulo + 360.0, 360.0);
                $fullTurns = random_int(6, 8) * 360.0;

                $state = [
                    'spinId' => (int) ($state['spinId'] ?? 0) + 1,
                    'startAt' => $now + START_DELAY_MS,
                    'durationMs' => SPIN_DURATION_MS,
                    'selectedIndex' => $selectedIndex,
                    'selectedTitle' => $movies[$selectedIndex],
                    'startRotation' => $previousEnd,
                    'endRotation' => $previousEnd + $fullTurns + $delta,
                    'movieHash' => $movieHash,
                    'updatedAt' => $now
                ];
                writeState($statePath, $state);
            }
        }

        $payload = publicPayload($movies, $movieHash, $state);
    } finally {
        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);
    }

    sendJson($payload);
} catch (InvalidArgumentException $error) {
    sendJson(['error' => $error->getMessage()], 400);
} catch (Throwable $error) {
    error_log('Movie wheel error: ' . $error->getMessage());
    sendJson(['error' => 'The movie wheel server encountered an error.'], 500);
}

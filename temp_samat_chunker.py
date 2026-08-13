from pathlib import Path
p = Path(r'C:\Users\ЗС\Desktop\SatuSystem\temp_samat_prompt_readable.txt')
text = p.read_text(encoding='utf-8')
start = text.index('<untrusted-data-b7217dbe-7797-4d60-9910-b8d6118eda08>')
end = text.rindex('</untrusted-data-b7217dbe-7797-4d60-9910-b8d6118eda08>')
body = text[start:end+len('</untrusted-data-b7217dbe-7797-4d60-9910-b8d6118eda08>')]
out = Path(r'C:\Users\ЗС\Desktop\SatuSystem\temp_samat_prompt_chunks.txt')
with out.open('w', encoding='utf-8') as f:
    i = 0
    while i < len(body):
        f.write(body[i:i+1000] + '\n')
        i += 1000
print('CHUNKS', len(body))

import os
import pandas as pd
import requests
from bs4 import BeautifulSoup
import re
import time


# --- Step 1: Scrape Programme Overview ---

OVERVIEW_FILE = 'data/raw/2026 JUPAS Program Overview.csv'

if os.path.exists(OVERVIEW_FILE):
    print(f'Step 1 already done, loading {OVERVIEW_FILE}')
    df_all = pd.read_csv(OVERVIEW_FILE, index_col='JUPAS Catalogue No.')
    university_data = df_all.reset_index().to_dict('records')
else:
    url_JUPAS = 'https://www.jupas.edu.hk/en/programmes-offered/by-funding-category/'
    response_JUPAS = requests.get(url_JUPAS)
    soup_JUPAS = BeautifulSoup(response_JUPAS.content, 'html.parser')

    university_abbrs = []
    for div in soup_JUPAS.find_all('div', class_='schools_container'):
        for a in div.find_all('a'):
            university_abbrs.append(a['href'].split('/')[-1])

    university_abbrs = [abbr.replace('programme-information', 'sssdp') for abbr in university_abbrs]

    university_data = []

    for university in university_abbrs:
        url_uni = 'https://www.jupas.edu.hk/en/programme/' + university + '/'
        response_uni = requests.get(url_uni)
        soup_uni = BeautifulSoup(response_uni.content, 'html.parser')

        table = soup_uni.find('table', class_='program_table program_table-hasFC')
        if not table:
            print(f'\nSkipping {university} — no programme table found')
            continue

        column_names = [th.text for th in table.find_all('th')]
        column_names.append('chinese_name')
        column_names.append('url')

        datalist = []

        for tr in table.find_all('tr'):
            if tr.find('th'):
                continue

            row = [td.text for td in tr.find_all('td')]
            english_name = tr.find('td', class_='c-ft').contents[0].strip()
            row[-1] = english_name

            url = tr.find('td', class_='c-no').find('a')['href']
            chinese_name = tr.find('td', class_='c-ft').find('span', class_='tname-cn').text

            row.append(chinese_name)
            row.append(url)

            data = dict(zip(column_names, row))
            datalist.append(data)

        university_data.extend(datalist)
        print(f'Progress: {len(university_data)}', end='\r')

    df_all = pd.DataFrame(university_data).set_index('JUPAS Catalogue No.')
    print(f'\nTotal programmes scraped: {len(df_all)}')
    df_all.to_csv(OVERVIEW_FILE)


# --- Step 2: Scrape Offer Table ---

offer_table = pd.DataFrame()

for count, program in enumerate(university_data):
    time.sleep(1)

    print(f'Currently Scraping: {program["JUPAS Catalogue No."]}, Progress: {count+1}/{len(university_data)}', end='\r')

    url_programme = 'https://www.jupas.edu.hk/' + program['url']
    school = program['Institution / Scheme']

    response_programme = requests.get(url_programme)
    soup_programme = BeautifulSoup(response_programme.content, 'html.parser')

    quota_div = soup_programme.find('div', class_='programInfo_block programInfo_block-firstyear')
    quota = ''
    if quota_div:
        # Only the first integer AFTER the "First Year Intake" label is the
        # intake quota. Stripping all non-digits concatenates breakdown numbers
        # (e.g. "JS6200 & JS6999" or "around 37, 49, ...") into a bogus value.
        m = re.search(
            r'First Year Intake(?:\s*\([^)]*\))?\s*:?\s*(\d+)',
            quota_div.get_text(' ', strip=True),
            flags=re.IGNORECASE,
        )
        quota = m.group(1) if m else ''
        # Guard against merged/breakdown numbers leaking through (e.g. a
        # combined "30-50 / 300 / JS4501 / JS4502" intake rendered without
        # separators makes (\d+) over-capture). Real first-year intakes are
        # well under 3000; anything larger is a parse artefact, so drop it
        # rather than poison the offer table.
        if quota and int(quota) > 3000:
            quota = ''

    title = soup_programme.find('p', class_='strokeBar_title', string="Statistics")

    if title:
        div = title.find_parent('div', class_='strokeBar_box')
        tables = div.find_all('table', class_='js-swrapTable program_brand_table js-swiptable statistic-table')

        a_stat = []
        o_stat = []

        for table in tables:
            table_body = table.find('tbody').find_all('tr')
            table_rows = [[item.text.strip() for item in rows.find_all('td')] for rows in table_body]

            header = table_rows[0]
            formatted_data = [dict(zip(header, row)) for row in table_rows[1:]]

            if tables.index(table) == 0:
                a_stat = formatted_data
            else:
                o_stat = formatted_data

        a_df = pd.DataFrame.from_dict(a_stat)
        a_df['JUPAS'] = program["JUPAS Catalogue No."]
        a_df['Type'] = "Application"
        a_df['School'] = school
        a_df['Quota'] = quota

        o_df = pd.DataFrame.from_dict(o_stat)
        o_df['JUPAS'] = program["JUPAS Catalogue No."]
        o_df['Type'] = "Offer"
        o_df['School'] = school
        o_df['Quota'] = quota

        combined_df = pd.concat([a_df, o_df], ignore_index=True)
        offer_table = pd.concat([offer_table, combined_df], ignore_index=True)
    else:
        new_row = {'JUPAS': program["JUPAS Catalogue No."], 'School': school, 'Quota': quota}
        offer_table = pd.concat([offer_table, pd.DataFrame([new_row])], ignore_index=True)

print(f'\nDone. Total rows: {len(offer_table)}')
offer_table.to_csv('data/raw/2026 JUPAS Offer Table.csv', index=False)

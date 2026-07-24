import csv
import sys
import math
import argparse

def convert_tshmu_voltage_to_celsius(voltage):
    try:
        v = float(voltage)
    except ValueError:
        return voltage
        
    # The old firmware used strain gauge packing:
    # strain = (ADC / 4095.0) * 6600 - 3300
    # And the parser divided by 1000.0, so:
    # v = ((ADC / 4095.0) * 6600 - 3300) / 1000.0
    
    # 1. Reverse the math to get raw ADC value (0-4095)
    adc = (v * 1000.0 + 3300.0) / 6600.0 * 4095.0
    
    # Clip ADC to prevent math domain errors (should be between 1 and 4094)
    adc = max(1.0, min(4094.0, adc))
    
    # 2. Calculate Thermistor Resistance (assuming 10k pullup and 3.3V reference)
    # V_therm = 3.3 * (adc / 4095)
    # R_therm = 10000 * V_therm / (3.3 - V_therm)
    r_therm = 10000.0 * adc / (4095.0 - adc)
    
    # 3. Steinhart-Hart Equation (assuming NTC 10k at 25C, B=3950)
    # T = 1 / (1/T0 + 1/B * ln(R/R0)) - 273.15
    t0 = 298.15
    b = 3950.0
    r0 = 10000.0
    
    inv_t = (1.0 / t0) + (1.0 / b) * math.log(r_therm / r0)
    temp_celsius = (1.0 / inv_t) - 273.15
    
    return round(temp_celsius, 1)

def main():
    parser = argparse.ArgumentParser(description="Fix TSHMU voltages in an old CSV log, converting them to Celsius.")
    parser.add_argument("input_csv", help="The old CSV file with voltage values")
    parser.add_argument("output_csv", help="The new CSV file to save to")
    args = parser.parse_args()
    
    with open(args.input_csv, 'r') as infile, open(args.output_csv, 'w', newline='') as outfile:
        reader = csv.reader(infile)
        writer = csv.writer(outfile)
        
        headers = next(reader)
        writer.writerow(headers)
        
        # Find which columns are TSHMU temps
        tshmu_cols = [i for i, h in enumerate(headers) if 'tshmu' in h.lower() and 'temp' in h.lower()]
        
        for row in reader:
            for col_idx in tshmu_cols:
                if row[col_idx]:
                    row[col_idx] = convert_tshmu_voltage_to_celsius(row[col_idx])
            writer.writerow(row)
            
    print(f"Successfully converted TSHMU voltages to Celsius and saved to {args.output_csv}")

if __name__ == '__main__':
    main()
